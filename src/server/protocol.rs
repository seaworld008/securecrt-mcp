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
use std::borrow::Cow;

const SUPPORTED: &[ProtocolVersion] =
    &[ProtocolVersion::V_2026_07_28, ProtocolVersion::V_2025_11_25];

pub(crate) struct ProtocolService(SecureCrtServer);

impl SecureCrtServer {
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
