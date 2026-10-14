//! OpenSSH uses the same operator policy and before-send audit as native tabs.
use crate::{
    audit::AuditLog,
    policy::{Decision, PolicyEngine},
};
use anyhow::{Result, ensure};

#[derive(Clone)]
pub(super) struct DispatchGuard {
    pub policy: PolicyEngine,
    audit: AuditLog,
}

impl DispatchGuard {
    pub fn new(policy: PolicyEngine, audit: AuditLog) -> Self {
        Self { policy, audit }
    }

    pub async fn command(&self, session: &str, id: &str, command: &str) -> Result<()> {
        let decision = self.policy.classify_command(command);
        self.audit
            .record(
                "dispatch_attempt",
                id,
                session,
                &decision.reason,
                Some(command),
            )
            .await?;
        ensure!(decision.decision == Decision::Allow, "{}", decision.reason);
        Ok(())
    }

    pub async fn raw(&self, session: &str, text: &str) -> Result<()> {
        ensure!(
            self.policy.raw_send_allowed(),
            "interactive raw input disabled: explicitly enable allow_raw_send and client approval"
        );
        self.audit
            .record(
                "stream_write",
                "",
                session,
                "explicit raw input",
                Some(text),
            )
            .await
    }

    pub async fn interrupt(&self, session: &str) -> Result<()> {
        ensure!(
            self.policy.interrupt_allowed(),
            "interrupt disabled by local policy; nothing sent"
        );
        self.audit
            .record(
                "interrupt",
                "",
                session,
                "explicit interrupt; remote termination unproven",
                None,
            )
            .await
    }
}
