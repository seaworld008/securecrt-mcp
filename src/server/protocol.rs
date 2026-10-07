//! Protocol policy follows the official MCP versioning and discovery contracts.
//! https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
use super::SecureCrtServer;
use rmcp::{
    ErrorData, RoleServer, ServerHandler, Service,
    model::{
        Implementation, InitializeRequestParams, InitializeResult, ProtocolVersion,
        ServerCapabilities, ServerConfig,
    },
    service::{NotificationContext, RequestContext},
};
use rmcp::{
    model::{
        ClientCapabilities, ClientJsonRpcMessage, GetMeta, JsonRpcMessage, NotificationMetaObject,
        ServerJsonRpcMessage,
    },
    transport::{Transport, async_rw::AsyncRwTransport},
};
use std::borrow::Cow;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

struct EraTransport<T> {
    inner: T,
    legacy: Arc<AtomicBool>,
}

fn notification_allowed(meta: &NotificationMetaObject, legacy: bool) -> bool {
    let Some(value) = meta.get("io.modelcontextprotocol/protocolVersion") else {
        return legacy;
    };
    match value.as_str() {
        Some("2025-11-25") => legacy,
        Some("2026-07-28") => meta
            .get("io.modelcontextprotocol/clientCapabilities")
            .is_some_and(|value| {
                serde_json::from_value::<ClientCapabilities>(value.clone()).is_ok()
            }),
        _ => false,
    }
}

impl<T: Transport<RoleServer>> Transport<RoleServer> for EraTransport<T> {
    type Error = T::Error;
    fn send(
        &mut self,
        item: ServerJsonRpcMessage,
    ) -> impl Future<Output = Result<(), Self::Error>> + Send + 'static {
        let initialized = matches!(&item,JsonRpcMessage::Response(response)
            if matches!(&response.result,rmcp::model::ServerResult::InitializeResult(info)
                if info.protocol_version==ProtocolVersion::V_2025_11_25));
        let send = self.inner.send(item);
        let legacy = self.legacy.clone();
        async move {
            let result = send.await;
            if result.is_ok() && initialized {
                legacy.store(true, Ordering::SeqCst);
            }
            result
        }
    }
    async fn receive(&mut self) -> Option<ClientJsonRpcMessage> {
        loop {
            let message = self.inner.receive().await?;
            if let JsonRpcMessage::Notification(notification) = &message {
                if !notification_allowed(
                    notification.notification.get_meta(),
                    self.legacy.load(Ordering::SeqCst),
                ) {
                    continue;
                }
            }
            return Some(message);
        }
    }
    async fn close(&mut self) -> Result<(), Self::Error> {
        self.inner.close().await
    }
}

const SUPPORTED: &[ProtocolVersion] =
    &[ProtocolVersion::V_2026_07_28, ProtocolVersion::V_2025_11_25];

pub(crate) struct ProtocolService(SecureCrtServer);

impl SecureCrtServer {
    pub(crate) fn protocol_stdio() -> impl Transport<RoleServer> {
        EraTransport {
            inner: AsyncRwTransport::new_server(tokio::io::stdin(), tokio::io::stdout()),
            legacy: Arc::new(AtomicBool::new(false)),
        }
    }
    pub(crate) fn into_protocol_service(self) -> ProtocolService {
        ProtocolService(self)
    }
}

impl Service<RoleServer> for ProtocolService {
    async fn handle_request(
        &self,
        request: rmcp::model::ClientRequest,
        context: RequestContext<RoleServer>,
    ) -> Result<rmcp::model::ServerResult, ErrorData> {
        if !matches!(&request, rmcp::model::ClientRequest::InitializeRequest(_))
            && context.meta.protocol_version() == Some(ProtocolVersion::V_2025_11_25)
            && context.peer.peer_info().is_none()
        {
            if !context
                .meta
                .missing_required_keys(&ProtocolVersion::V_2026_07_28)
                .is_empty()
            {
                return Err(ErrorData::invalid_params(
                    "Malformed per-request metadata",
                    None,
                ));
            }
            return Err(ErrorData::invalid_request(
                "2025-11-25 requires an initialize handshake",
                None,
            ));
        }
        Service::<RoleServer>::handle_request(&self.0, request, context).await
    }
    async fn handle_notification(
        &self,
        notification: rmcp::model::ClientNotification,
        context: NotificationContext<RoleServer>,
    ) -> Result<(), ErrorData> {
        if !notification_allowed(&context.meta, context.peer.peer_info().is_some()) {
            return Err(ErrorData::invalid_request(
                "notification protocol era or metadata is invalid",
                None,
            ));
        }
        Service::<RoleServer>::handle_notification(&self.0, notification, context).await
    }
    fn get_info(&self) -> ServerConfig {
        Service::<RoleServer>::get_info(&self.0)
    }
    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Service::<RoleServer>::supported_protocol_versions(&self.0)
    }
}

#[rmcp::tool_handler(router = Self::tool_router())]
impl ServerHandler for SecureCrtServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_protocol_version(ProtocolVersion::V_2025_11_25)
            .with_server_info(Implementation::new(
                env!("CARGO_PKG_NAME"),
                env!("CARGO_PKG_VERSION"),
            ))
    }

    fn supported_protocol_versions(&self) -> Cow<'static, [ProtocolVersion]> {
        Cow::Borrowed(SUPPORTED)
    }

    async fn initialize(
        &self,
        request: InitializeRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<InitializeResult, ErrorData> {
        // The legacy entry point is deliberately pinned; newer revisions use
        // server/discover or inline requests rather than an initialize fallback.
        if request.protocol_version == ProtocolVersion::V_2026_07_28 {
            return Err(ErrorData::invalid_request(
                "2026-07-28 uses server/discover or per-request metadata; initialize requires 2025-11-25",
                None,
            ));
        }
        if request.protocol_version != ProtocolVersion::V_2025_11_25 {
            return Err(ErrorData::unsupported_protocol_version(
                request.protocol_version,
                SUPPORTED,
            ));
        }
        context.peer.set_peer_info(request.clone());
        self.negotiate_initialize(&request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn notifications_are_filtered_before_sdk_cancellation_dispatch() {
        use tokio::io::AsyncWriteExt;
        let (mut client, server) = tokio::io::duplex(4096);
        let (read, write) = tokio::io::split(server);
        let mut transport = EraTransport {
            inner: AsyncRwTransport::new_server(read, write),
            legacy: Arc::new(AtomicBool::new(false)),
        };
        for (version, caps) in [
            ("2025-11-25", Some(serde_json::json!({}))),
            ("2026-07-28", None),
            ("2026-07-28", Some(serde_json::json!({}))),
        ] {
            let mut meta = serde_json::json!({"io.modelcontextprotocol/protocolVersion":version});
            if let Some(caps) = caps {
                meta["io.modelcontextprotocol/clientCapabilities"] = caps;
            }
            let value = serde_json::json!({"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1,"_meta":meta}});
            client
                .write_all((value.to_string() + "\n").as_bytes())
                .await
                .unwrap();
        }
        let message = transport.receive().await.unwrap();
        let JsonRpcMessage::Notification(notification) = message else {
            panic!("expected notification")
        };
        assert_eq!(
            notification.notification.get_meta()["io.modelcontextprotocol/protocolVersion"],
            serde_json::json!("2026-07-28")
        );
        transport.legacy.store(true, Ordering::SeqCst);
        let meta = serde_json::from_value::<NotificationMetaObject>(
            serde_json::json!({"io.modelcontextprotocol/protocolVersion":"2025-11-25"}),
        )
        .unwrap();
        assert!(notification_allowed(&meta, true));
        assert!(!notification_allowed(&NotificationMetaObject::new(), false));
        assert!(notification_allowed(&NotificationMetaObject::new(), true));
    }
}
