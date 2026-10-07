//! Protocol policy follows the official MCP versioning and discovery contracts.
//! https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
use super::SecureCrtServer;
use rmcp::{
    ErrorData, RoleServer, ServerHandler,
    model::{
        Implementation, InitializeRequestParams, InitializeResult, ProtocolVersion,
        ServerCapabilities, ServerConfig,
    },
    service::RequestContext,
};
use std::borrow::Cow;

const SUPPORTED: &[ProtocolVersion] =
    &[ProtocolVersion::V_2026_07_28, ProtocolVersion::V_2025_11_25];

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
