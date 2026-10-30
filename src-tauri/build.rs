fn main() {
    println!("cargo:rerun-if-env-changed=ADB_SHARE_BUILD_TIMESTAMP");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=../LICENSE");
    println!("cargo:rerun-if-changed=../THIRD_PARTY_NOTICES.txt");
    let timestamp = std::env::var("ADB_SHARE_BUILD_TIMESTAMP").unwrap_or_else(|_| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
            .to_string()
    });
    timestamp.parse::<u64>().expect("Invalid build timestamp");
    println!("cargo:rustc-env=ADB_SHARE_BUILD_TIMESTAMP={timestamp}");
    tauri_build::build()
}
