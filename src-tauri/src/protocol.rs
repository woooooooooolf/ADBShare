use serde::Serialize;
use std::{io, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub async fn read_frame(stream: &mut TcpStream) -> Result<String> {
    timeout(Duration::from_secs(8), async {
        let mut header = [0; 4];
        stream.read_exact(&mut header).await?;
        let len = usize::from_str_radix(std::str::from_utf8(&header)?, 16)?;
        let mut body = vec![0; len];
        stream.read_exact(&mut body).await?;
        Ok(String::from_utf8(body)?)
    })
    .await?
}
pub async fn frame(stream: &mut TcpStream, value: &str) -> Result<()> {
    if value.len() > 65535 {
        return Err("ADB frame exceeds 65535 bytes".into());
    }
    stream
        .write_all(format!("{:04x}", value.len()).as_bytes())
        .await?;
    stream.write_all(value.as_bytes()).await?;
    Ok(())
}
pub async fn fail(stream: &mut TcpStream, message: &str) -> Result<()> {
    stream.write_all(b"FAIL").await?;
    frame(stream, message).await
}
pub async fn okay_frame(stream: &mut TcpStream, message: &str) -> Result<()> {
    stream.write_all(b"OKAY").await?;
    frame(stream, message).await
}
pub async fn connect(port: u16) -> Result<TcpStream> {
    let stream = timeout(
        Duration::from_secs(3),
        TcpStream::connect(("127.0.0.1", port)),
    )
    .await??;
    stream.set_nodelay(true)?;
    Ok(stream)
}
pub async fn read_status(stream: &mut TcpStream) -> Result<()> {
    let mut status = [0; 4];
    timeout(Duration::from_secs(8), stream.read_exact(&mut status)).await??;
    match &status {
        b"OKAY" => Ok(()),
        b"FAIL" => Err(read_frame(stream).await?.into()),
        _ => Err(io::Error::new(io::ErrorKind::InvalidData, "Invalid ADB status").into()),
    }
}
pub async fn query(port: u16, request: &str) -> Result<String> {
    let mut stream = connect(port).await?;
    frame(&mut stream, request).await?;
    read_status(&mut stream).await?;
    read_frame(&mut stream).await
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub serial: String,
    pub state: String,
    pub model: String,
    pub transport_id: String,
    pub kind: String,
}
pub fn devices(payload: &str) -> Vec<Device> {
    payload
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let serial = fields.next()?.to_owned();
            let state = fields.next()?.to_owned();
            let rest: Vec<_> = fields.collect();
            let field = |name: &str| {
                rest.iter()
                    .find_map(|f| f.strip_prefix(name))
                    .unwrap_or("")
                    .to_string()
            };
            let kind = if serial.starts_with("emulator-") || serial.contains(':') {
                "local"
            } else {
                "usb"
            }
            .into();
            Some(Device {
                serial,
                state,
                model: field("model:"),
                transport_id: field("transport_id:"),
                kind,
            })
        })
        .collect()
}
pub fn filter(payload: &str, members: &[String]) -> String {
    payload
        .lines()
        .filter(|line| {
            line.split_whitespace()
                .next()
                .is_some_and(|s| members.iter().any(|m| m == s))
        })
        .map(|line| format!("{line}\n"))
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_membership_and_transport_kinds() {
        let input="ABC device model:Phone transport_id:8\nABCD offline\nemulator-5554 device transport_id:9\n";
        assert_eq!(
            filter(input, &["ABC".into()]),
            "ABC device model:Phone transport_id:8\n"
        );
        let d = devices(input);
        assert_eq!(d[0].transport_id, "8");
        assert_eq!(d[2].kind, "local");
    }
}
