use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    name: &'static str,
    version: &'static str,
    build_timestamp: u64,
    author: &'static str,
    license: &'static str,
}
#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "ADBShare",
        version: env!("CARGO_PKG_VERSION"),
        build_timestamp: env!("ADB_SHARE_BUILD_TIMESTAMP").parse().unwrap(),
        author: env!("CARGO_PKG_AUTHORS"),
        license: env!("CARGO_PKG_LICENSE"),
    }
}
fn third_party_sections() -> impl Iterator<Item = &'static str> {
    include_str!("../../THIRD_PARTY_NOTICES.txt")
        .split("\n============================================================================\n")
        .skip(1)
}
#[tauri::command]
pub fn third_party_components() -> Vec<ThirdPartyComponent> {
    third_party_sections()
        .filter_map(|section| {
            let mut lines = section.lines();
            let mut heading = lines.next()?.split_whitespace();
            Some(ThirdPartyComponent {
                name: heading.next()?,
                version: heading.next()?,
                license: lines.next()?.strip_prefix("License: ")?,
            })
        })
        .collect()
}
#[derive(Serialize)]
pub struct ThirdPartyComponent {
    name: &'static str,
    version: &'static str,
    license: &'static str,
}
#[tauri::command]
pub fn license_document() -> &'static str {
    include_str!("../../LICENSE")
}

#[cfg(test)]
mod license_tests {
    use super::*;

    #[test]
    fn component_table_covers_the_embedded_catalog_and_preserves_license_expressions() {
        let components = third_party_components();
        let expected: usize = include_str!("../../THIRD_PARTY_NOTICES.txt")
            .lines()
            .find_map(|line| line.strip_prefix("Components: "))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(components.len(), expected);
        assert!(components
            .iter()
            .all(|c| !c.name.is_empty() && !c.version.is_empty() && !c.license.is_empty()));
        let api = components
            .iter()
            .find(|c| c.name == "@tauri-apps/api")
            .unwrap();
        assert_eq!(api.license, "Apache-2.0 OR MIT");
        let serialized = serde_json::to_value(&components).unwrap();
        assert!(serialized
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c.as_object().unwrap().len() == 3));
    }
}
