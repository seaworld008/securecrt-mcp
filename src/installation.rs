//! User-scoped installation and additive Codex configuration. No PATH changes.
use crate::{config, initialize, reject_symlink};
use anyhow::{Context, Result, ensure};
use std::{
    fs,
    path::{Path, PathBuf},
};
use toml_edit::{DocumentMut, value};

fn private_write(path: &Path, bytes: &[u8], executable: bool) -> Result<()> {
    reject_symlink(path)?;
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(if executable { 0o700 } else { 0o600 });
    }
    #[cfg(not(unix))]
    let _ = executable;
    use std::io::Write;
    let mut file = options.open(&temporary)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&temporary, path).context("replace installed file")?;
    Ok(())
}

fn codex_path() -> Result<PathBuf> {
    if let Some(root) = std::env::var_os("CODEX_HOME") {
        let root = PathBuf::from(root);
        ensure!(root.is_absolute(), "CODEX_HOME must be absolute");
        return Ok(root.join("config.toml"));
    }
    let home = if cfg!(windows) {
        std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
    } else {
        std::env::var_os("HOME")
    };
    Ok(PathBuf::from(home.context("HOME/USERPROFILE unavailable")?).join(".codex/config.toml"))
}

pub(crate) fn configure_codex(text: &str, binary: &Path) -> Result<String> {
    let mut document = text
        .parse::<DocumentMut>()
        .context("invalid Codex TOML; existing configuration preserved")?;
    if let Some(servers) = document.get("mcp_servers") {
        ensure!(
            servers.as_table_like().is_some(),
            "mcp_servers must be a TOML table; configuration preserved"
        );
        if let Some(server) = servers.get("securecrt") {
            ensure!(
                server.as_table_like().is_some(),
                "securecrt MCP entry must be a table; configuration preserved"
            );
        }
    }
    let table = &mut document["mcp_servers"]["securecrt"];
    table["command"] = value(binary.to_string_lossy().as_ref());
    let mut arguments = toml_edit::Array::new();
    arguments.push("serve");
    table["args"] = value(arguments);
    if table.get("startup_timeout_sec").is_none() {
        table["startup_timeout_sec"] = value(30);
    }
    if table.get("tool_timeout_sec").is_none() {
        table["tool_timeout_sec"] = value(90);
    }
    // Existing approvals/enabled_tools and all other client settings are owned
    // by the operator. A new entry uses the client's own approval defaults.
    Ok(document.to_string())
}

pub fn install() -> Result<()> {
    let root = config::app_dir()?;
    reject_symlink(&root)?;
    let bin = root.join("bin");
    reject_symlink(&bin)?;
    fs::create_dir_all(&bin)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700))?;
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o700))?;
    }
    let source = std::env::current_exe()?;
    let destination = bin.join(if cfg!(windows) {
        "securecrt-mcp.exe"
    } else {
        "securecrt-mcp"
    });
    reject_symlink(&destination)?;
    let bytes = fs::read(&source)?;
    if !destination.exists() || fs::read(&destination)? != bytes {
        private_write(&destination, &bytes, true)?;
    }
    initialize(false)?;
    let path = codex_path()?;
    reject_symlink(&path)?;
    let directory = path
        .parent()
        .context("Codex config directory unavailable")?;
    fs::create_dir_all(directory)?;
    let old = if path.exists() {
        fs::read_to_string(&path)?
    } else {
        String::new()
    };
    let updated = configure_codex(&old, &destination)?;
    if old != updated {
        private_write(&path, updated.as_bytes(), false)?;
    }
    println!("installed_binary={}", destination.display());
    println!("codex_config={}", path.display());
    println!("安装完成。重新加载 Codex；在终端空闲时停止旧脚本并选择上面显示的固定入口。");
    #[cfg(target_os = "macos")]
    println!(
        "Mac 使用 SecureCRT 已加载的 Python 引擎；不修改 PATH，不安装 Python 包。缺少引擎时按终端自身提示安装支持的官方运行时并重启 SecureCRT，再运行 doctor。"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn config_preserves_comments_and_operator_approval() {
        let old = "# keep comment\nmodel = \"existing\"\n[mcp_servers.other]\ncommand = \"unchanged\"\n[mcp_servers.securecrt]\ncommand = \"old\"\nargs = [\"old\"]\ndefault_tools_approval_mode = \"prompt\"\nenabled_tools = [\"connector_list\"]\n";
        let new = configure_codex(old, Path::new("/test/private/securecrt-mcp")).unwrap();
        assert!(new.contains("# keep comment"));
        let parsed: toml::Value = toml::from_str(&new).unwrap();
        assert_eq!(parsed["model"].as_str(), Some("existing"));
        assert_eq!(
            parsed["mcp_servers"]["other"]["command"].as_str(),
            Some("unchanged")
        );
        assert_eq!(
            parsed["mcp_servers"]["securecrt"]["default_tools_approval_mode"].as_str(),
            Some("prompt")
        );
        assert_eq!(
            parsed["mcp_servers"]["securecrt"]["enabled_tools"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            configure_codex(&new, Path::new("/test/private/securecrt-mcp")).unwrap(),
            new
        );
    }
    #[test]
    fn new_config_is_additive_and_invalid_toml_is_rejected() {
        let output = configure_codex("", Path::new("/binary with spaces/securecrt-mcp")).unwrap();
        let parsed: toml::Value = toml::from_str(&output).unwrap();
        assert_eq!(
            parsed["mcp_servers"]["securecrt"]["args"][0].as_str(),
            Some("serve")
        );
        assert!(configure_codex("this is not TOML", Path::new("/binary")).is_err());
    }
}
