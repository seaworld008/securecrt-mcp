    #[tool(description="Attach once to an already authenticated SecureCRT session. shared/exclusive/observe are connector ownership modes, not a native keyboard lock. No command is sent and no future approval is granted. Inspect current target; configured host is not proof of nested SSH identity.",annotations(read_only_hint=false,destructive_hint=false))]
    async fn securecrt_attach(&self,Parameters(p):Parameters<crate::terminal::AttachParams>)->Result<String,McpError>{result(self.engine.attach(p).await)}

    #[tool(description="Execute an explicitly client-approved command through a retained attachment. Uses persistent transport and atomic native context validation. mode must match the actual terminal. Returns bounded output and command_id; never resubmit an unknown outcome.",annotations(read_only_hint=false,destructive_hint=true,idempotent_hint=false))]
    async fn securecrt_exec(&self,Parameters(p):Parameters<crate::terminal::ExecParams>)->Result<String,McpError>{result(self.engine.exec(p).await)}

    #[tool(description="Submit 1..20 explicit POSIX commands in one approval context. Each command has its own output, exit code and audit event. Returns batch_id; poll get_batch_status. stop by default; continue permits only confirmed nonzero exits, never uncertainty. Not an atomic shell transaction.",annotations(read_only_hint=false,destructive_hint=true,idempotent_hint=false))]
    async fn securecrt_exec_batch(&self,Parameters(p):Parameters<crate::terminal::BatchParams>)->Result<String,McpError>{result(self.engine.exec_batch(p).await)}

    #[tool(description="Read progress/results of an existing batch, never execute or retry commands.",annotations(read_only_hint=true,destructive_hint=false))]
    async fn securecrt_get_batch_status(&self,Parameters(p):Parameters<crate::terminal::BatchStatusParams>)->Result<String,McpError>{result(self.engine.batch_status(&p.batch_id).await)}

    #[tool(description="Renew a retained attachment and report sampled input-context changes. No SSH command or secret probe. Does not authenticate nested SSH hosts.",annotations(read_only_hint=true,destructive_hint=false))]
    async fn securecrt_heartbeat(&self,Parameters(p):Parameters<crate::terminal::AttachmentParams>)->Result<String,McpError>{result(self.engine.bridge.call("heartbeat",json!({"attachment_id":p.attachment_id})).await)}

    #[tool(description="Release connector attachment only. Does not disconnect SSH, kill processes, or clear unresolved commands.",annotations(read_only_hint=false,destructive_hint=false))]
    async fn securecrt_detach(&self,Parameters(p):Parameters<crate::terminal::AttachmentParams>)->Result<String,McpError>{result(self.engine.detach(&p.attachment_id).await)}

    #[tool(description="Start an explicitly approved long-running terminal command on an attachment, with continuous bounded capture rather than completion markers. Returns command_id immediately. Read incrementally with shell_read; only explicit interrupt sends Ctrl+C. Native quiet reads may take up to one second.",annotations(read_only_hint=false,destructive_hint=true,idempotent_hint=false))]
    async fn securecrt_shell_open(&self,Parameters(mut p):Parameters<crate::terminal::ExecParams>)->Result<String,McpError>{p.mode=crate::model::CaptureMode::Stream;p.wait_ms=Some(0);result(self.engine.exec(p).await)}

    #[tool(description="Read incremental stream output with absolute UTF-8 byte cursors and optional long wait. Reports gaps when bounded ring-buffer retention is exceeded. No remote input.",annotations(read_only_hint=true,destructive_hint=false))]
    async fn securecrt_shell_read(&self,Parameters(p):Parameters<crate::terminal::StreamReadParams>)->Result<String,McpError>{result(self.engine.stream_read(p).await)}

    #[tool(description="Explicit interactive raw input into an active stream. Requires local allow_raw_send and client approval. Raw fragments are not a safely classifiable shell command; never send secrets unless the operator intended it.",annotations(read_only_hint=false,destructive_hint=true,idempotent_hint=false))]
    async fn securecrt_shell_write(&self,Parameters(p):Parameters<crate::terminal::StreamWriteParams>)->Result<String,McpError>{result(self.engine.stream_write(p).await)}

    #[tool(description="Stop local capture of this stream only, without sending Ctrl+C or disconnecting SSH. Remote work may continue; inspect original terminal and explicitly acknowledge idle before another command.",annotations(read_only_hint=false,destructive_hint=true,idempotent_hint=false))]
    async fn securecrt_shell_close(&self,Parameters(p):Parameters<JobParams>)->Result<String,McpError>{result(self.engine.stream_close(&p.command_id).await)}

    #[tool(description="Measure 20 local bridge pings and report connection reuse, RPC and native-read metrics. No remote commands; this is not an SSH/LLM latency benchmark.",annotations(read_only_hint=true,destructive_hint=false))]
    async fn securecrt_latency(&self)->Result<String,McpError>{result(self.engine.latency(20).await)}
