use std::process::Command;

pub fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}

/// Show the native save dialog. Record contents never enter shell code.
pub fn save_history(content: &str) -> Result<bool, String> {
    if content.len() > 64 * 1024 * 1024 {
        return Err("Export is too large".into());
    }
    let output = command("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-STA",
            "-Command",
            include_str!("platform/save_history.ps1"),
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into_owned());
    }
    let path = String::from_utf8(output.stdout).map_err(|e| e.to_string())?;
    let path = path.trim_start_matches('\u{feff}');
    if path.is_empty() {
        return Ok(false);
    }
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(true)
}
