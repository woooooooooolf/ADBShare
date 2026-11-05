#[cfg(windows)]
use std::process::Command;

#[cfg(windows)]
pub fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}

/// Reject root before configuration access, helper dispatch or desktop initialization.
pub fn check_user() -> Result<(), &'static str> {
    #[cfg(target_os = "linux")]
    // SAFETY: geteuid takes no pointers and has no failure case or side effects.
    if unsafe { libc::geteuid() } == 0 {
        return Err("ADBShare must run as a regular user. Please run it without sudo.");
    }
    Ok(())
}
