//! Windows script bootstrap. No Python installation, PATH changes or COM registration.
use crate::{WINDOWS_BRIDGE_SCRIPT, config, digest, reject_symlink};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
#[cfg(windows)]
use std::process::Command;
use std::{fs, path::Path};

#[cfg(windows)]
pub fn install_scripts() -> Result<()> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let binary = fs::read(std::env::current_exe()?)?;
    let encoded = STANDARD.encode(&binary);
    let chunks: Vec<String> = encoded
        .as_bytes()
        .chunks(8192)
        .map(|chunk| serde_json::to_string(std::str::from_utf8(chunk).expect("base64 is ASCII")))
        .collect::<std::result::Result<_, _>>()?;
    let common = format!(
        "var MCP_BINARY_SHA256 = {};\nvar MCP_BINARY_SIZE = {};\nvar MCP_NATIVE_SOURCE = {};\nvar MCP_BINARY_BASE64 = [\n{}\n];\n{}",
        serde_json::to_string(&digest::sha256_hex(&binary))?,
        binary.len(),
        serde_json::to_string(WINDOWS_BRIDGE_SCRIPT)?,
        chunks.join(",\n"),
        include_str!("../bridge/portable_launcher.js")
    );
    let root = config::app_dir()?;
    let xshell_folder = config::xshell_script_dir_path()?;
    for (backend, folder) in [("securecrt", root.clone()), ("xshell", xshell_folder)] {
        reject_symlink(&folder)?;
        fs::create_dir_all(&folder)?;
        let header = if backend == "securecrt" {
            "# $language = \"JScript\"\n# $interface = \"1.0\"\n"
        } else {
            ""
        };
        let script = format!("{header}var MCP_BACKEND = \"{backend}\";\n{common}");
        let path = folder.join(format!("securecrt-mcp-{backend}.js"));
        reject_symlink(&path)?;
        // Trial scope: replace the fixed entry, without introducing backup management.
        fs::write(&path, script)?;
        println!("native_{backend}_script={}", path.display());
    }
    Ok(())
}

pub fn transport_path(secret: &config::BridgeSecret) -> Result<std::path::PathBuf> {
    secret
        .ipc_dir
        .as_ref()
        .map(std::path::PathBuf::from)
        .map(Ok)
        .unwrap_or_else(config::xshell_ipc_dir_path)
}

fn host_runtime() -> Value {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Read the exact parent terminal process, rather than guessing from PATH.
        let script = format!(
            "$p=Get-CimInstance Win32_Process -Filter 'ProcessId={}'; $h=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ParentProcessId); $v=(Get-Item -LiteralPath $h.ExecutablePath).VersionInfo; $b=[IO.File]::ReadAllBytes($h.ExecutablePath); $pe=[BitConverter]::ToInt32($b,60); $machine=[BitConverter]::ToUInt16($b,$pe+4); @{{terminal_version=($v.ProductVersion -replace ',\\s*','.');host_pid=$h.ProcessId;os_version=[Environment]::OSVersion.Version.ToString();architecture=switch($machine){{34404{{'x64'}} 332{{'x86'}} 43620{{'arm64'}} default{{'unknown'}}}}}} | ConvertTo-Json -Compress",
            std::process::id()
        );
        let program = std::env::var_os("WINDIR")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|| "C:\\Windows".into())
            .join("System32/WindowsPowerShell/v1.0/powershell.exe");
        if let Ok(output) = Command::new(program)
            .creation_flags(0x08000000)
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output()
        {
            if output.status.success() {
                if let Ok(value) = serde_json::from_slice(&output.stdout) {
                    return value;
                }
            }
        }
    }
    json!({"terminal_version":"unknown","architecture":std::env::consts::ARCH,"os_version":"unknown"})
}

pub fn initialize_portable(backend: &str, manifest: &Path, expected_hash: &str) -> Result<()> {
    ensure!(
        matches!(backend, "securecrt" | "xshell"),
        "invalid terminal backend"
    );
    let executable = std::env::current_exe()?;
    ensure!(
        digest::sha256_hex(fs::read(&executable)?) == expected_hash,
        "portable executable checksum mismatch"
    );
    let root = config::app_dir()?;
    ensure!(
        manifest.is_absolute() && manifest.parent() == Some(root.as_path()),
        "manifest must be directly inside the private application directory"
    );
    reject_symlink(&root)?;
    fs::create_dir_all(&root)?;
    // Native initialization does not deploy Python or reset another backend's transport.
    let configuration = config::config_path()?;
    reject_symlink(&configuration)?;
    if !configuration.exists() {
        fs::write(
            &configuration,
            toml::to_string_pretty(&config::Config::default())?,
        )?;
    }
    let settings = config::Config::load()?;
    for (name, path, port) in [
        (
            "securecrt",
            config::bridge_config_path()?,
            settings.bridge.port,
        ),
        (
            "xshell",
            config::xshell_bridge_config_path()?,
            settings
                .bridge
                .port
                .checked_add(1)
                .context("bridge port too high")?,
        ),
    ] {
        reject_symlink(&path)?;
        if !path.exists() {
            let secret = config::BridgeSecret {
                host: settings.bridge.host.clone(),
                port,
                token: format!(
                    "{}{}",
                    uuid::Uuid::new_v4().simple(),
                    uuid::Uuid::new_v4().simple()
                ),
                max_request_bytes: config::MAX_FRAME,
                ipc_dir: (name == "xshell")
                    .then(|| root.join("xshell-ipc").to_string_lossy().into_owned()),
            };
            fs::write(path, serde_json::to_vec_pretty(&secret)?)?;
        }
    }
    let secret_path = if backend == "securecrt" {
        config::bridge_config_path()?
    } else {
        config::xshell_bridge_config_path()?
    };
    reject_symlink(&secret_path)?;
    let mut secret = if backend == "securecrt" {
        config::load_bridge_secret()?
    } else {
        config::load_xshell_bridge_secret()?
    };
    let ipc = root.join(format!("{backend}-native-ipc"));
    reject_symlink(&ipc)?;
    fs::create_dir_all(&ipc)?;
    secret.ipc_dir = Some(ipc.to_string_lossy().into_owned());
    fs::write(&secret_path, serde_json::to_vec_pretty(&secret)?)?;
    reject_symlink(manifest)?;
    let value = json!({"backend":backend,"bridge_version":env!("CARGO_PKG_VERSION"),
        "protocol_version":2,"bridge_instance":uuid::Uuid::new_v4().to_string(),
        "token":secret.token,"ipc_dir":ipc,"adapter_sha256":digest::sha256_hex(WINDOWS_BRIDGE_SCRIPT),
        "runtime":host_runtime(),"binary":executable});
    fs::write(manifest, serde_json::to_vec(&value)?).context("write portable startup manifest")?;
    Ok(())
}
