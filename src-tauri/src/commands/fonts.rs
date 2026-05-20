use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct SystemFont {
    pub family: String,
    pub weights: Vec<u16>,
    pub styles: Vec<String>,
}

#[tauri::command]
pub fn list_system_fonts() -> Vec<SystemFont> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let mut families = BTreeMap::<String, (BTreeSet<u16>, BTreeSet<String>)>::new();
    for face in db.faces() {
        for (family, _) in &face.families {
            let entry = families.entry(family.clone()).or_default();
            entry.0.insert(face.weight.0);
            entry.1.insert(font_style_name(face.style).to_string());
        }
    }

    families
        .into_iter()
        .map(|(family, (weights, styles))| SystemFont {
            family,
            weights: weights.into_iter().collect(),
            styles: styles.into_iter().collect(),
        })
        .collect()
}

fn font_style_name(style: fontdb::Style) -> &'static str {
    match style {
        fontdb::Style::Normal => "normal",
        fontdb::Style::Italic => "italic",
        fontdb::Style::Oblique => "oblique",
    }
}
