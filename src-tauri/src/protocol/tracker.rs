//! Device tracker schema from AOSP proto/adb_host.proto (field numbers are wire ABI).
//! https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/proto/adb_host.proto
use super::Result;
use prost::Message;
use std::fmt::Write;

#[derive(Clone, PartialEq, Message)]
pub struct Devices {
    #[prost(message, repeated, tag = "1")]
    pub device: Vec<Device>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Device {
    #[prost(string, tag = "1")]
    pub serial: String,
    #[prost(int32, tag = "2")]
    pub state: i32,
    #[prost(string, tag = "3")]
    pub bus_address: String,
    #[prost(string, tag = "4")]
    pub product: String,
    #[prost(string, tag = "5")]
    pub model: String,
    #[prost(string, tag = "6")]
    pub device: String,
    #[prost(int32, tag = "7")]
    pub connection_type: i32,
    #[prost(int64, tag = "8")]
    pub negotiated_speed: i64,
    #[prost(int64, tag = "9")]
    pub max_speed: i64,
    #[prost(int64, tag = "10")]
    pub transport_id: i64,
}

pub fn filter(payload: &[u8], members: &[String], text: bool) -> Result<Vec<u8>> {
    let mut devices = Devices::decode(payload)?;
    devices.device.retain(|d| members.contains(&d.serial));
    if !text {
        return Ok(devices.encode_to_vec());
    }
    let mut out = String::new();
    for device in devices.device {
        out.push_str("device {\n");
        for (name, value) in [
            ("serial", &device.serial),
            ("bus_address", &device.bus_address),
            ("product", &device.product),
            ("model", &device.model),
            ("device", &device.device),
        ] {
            if !value.is_empty() {
                let _ = writeln!(out, "  {name}: {}", quote(value));
            }
        }
        if device.state != 0 {
            let state = [
                "ANY",
                "CONNECTING",
                "AUTHORIZING",
                "UNAUTHORIZED",
                "NOPERMISSION",
                "DETACHED",
                "OFFLINE",
                "BOOTLOADER",
                "DEVICE",
                "HOST",
                "RECOVERY",
                "SIDELOAD",
                "RESCUE",
            ];
            let value = usize::try_from(device.state)
                .ok()
                .and_then(|i| state.get(i))
                .map(|s| (*s).to_owned())
                .unwrap_or_else(|| device.state.to_string());
            let _ = writeln!(out, "  state: {value}");
        }
        if device.connection_type != 0 {
            let value = match device.connection_type {
                1 => "USB".into(),
                2 => "SOCKET".into(),
                v => v.to_string(),
            };
            let _ = writeln!(out, "  connection_type: {value}");
        }
        for (name, value) in [
            ("negotiated_speed", device.negotiated_speed),
            ("max_speed", device.max_speed),
            ("transport_id", device.transport_id),
        ] {
            if value != 0 {
                let _ = writeln!(out, "  {name}: {value}");
            }
        }
        out.push_str("}\n");
    }
    Ok(out.into_bytes())
}

// Protobuf text uses C byte escapes, including octal UTF-8 bytes.
fn quote(value: &str) -> String {
    let mut out = String::from("\"");
    for byte in value.bytes() {
        match byte {
            b'"' => out.push_str("\\\""),
            b'\\' => out.push_str("\\\\"),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            32..=126 => out.push(byte as char),
            _ => {
                let _ = write!(out, "\\{byte:03o}");
            }
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_aosp_wire_fields_without_exposing_other_devices() {
        // Two Devices.device messages, with serial/state/connection_type/transport_id.
        let a = [10, 9, 10, 1, b'A', 16, 8, 56, 1, 80, 1];
        let b = [10, 9, 10, 1, b'B', 16, 6, 56, 1, 80, 2];
        let payload = [a.as_slice(), b.as_slice()].concat();
        assert_eq!(filter(&payload, &["A".into()], false).unwrap(), a);
        assert!(filter(&payload, &[], false).unwrap().is_empty());
        let text = String::from_utf8(filter(&payload, &["A".into()], true).unwrap()).unwrap();
        assert!(text.contains("state: DEVICE") && text.contains("transport_id: 1"));
        assert!(!text.contains("\"B\""));
        assert!(filter(&[10, 255], &["A".into()], false).is_err());
    }

    #[test]
    fn protobuf_text_quotes_utf8_and_control_bytes() {
        assert_eq!(quote("é\"\n\\"), "\"\\303\\251\\\"\\n\\\\\"");
    }
}
