use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub timestamp: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    pub username: String,
    pub display_name: String,
    pub user_color: Option<String>,
    #[serde(default)]
    pub badges: Vec<ChatBadge>,
    #[serde(default)]
    pub fragments: Vec<ChatFragment>,
    pub source_platform: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatBadge {
    pub provider: String,
    pub id: String,
    pub version: Option<String>,
    pub url: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ChatFragment {
    Text {
        text: String,
    },
    Emote {
        provider: String,
        id: String,
        url: String,
        text: Option<String>,
        #[serde(default)]
        zero_width: bool,
    },
}

impl ChatMessage {
    pub fn stable_key(&self) -> String {
        let mut out = format!(
            "{:.3}|{}|{}|{}|{}|",
            self.timestamp,
            self.created_at.as_deref().unwrap_or(""),
            self.username,
            self.display_name,
            self.user_color.as_deref().unwrap_or("")
        );
        for badge in &self.badges {
            out.push_str(&badge.provider);
            out.push(':');
            out.push_str(&badge.id);
            out.push(';');
        }
        for fragment in &self.fragments {
            match fragment {
                ChatFragment::Text { text } => out.push_str(text),
                ChatFragment::Emote {
                    provider,
                    id,
                    text,
                    zero_width,
                    ..
                } => {
                    out.push_str(provider);
                    out.push(':');
                    out.push_str(id);
                    if *zero_width {
                        out.push_str(":zw");
                    }
                    if let Some(text) = text {
                        out.push(':');
                        out.push_str(text);
                    }
                }
            }
        }
        out
    }
}

pub fn read_chat_messages(path: &Path) -> Result<Vec<ChatMessage>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))
}

pub fn write_chat_messages(path: &Path, messages: &[ChatMessage]) -> Result<()> {
    let text = serde_json::to_string_pretty(messages)?;
    std::fs::write(path, text).with_context(|| format!("write {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::ChatMessage;

    #[test]
    fn old_chat_json_without_created_at_still_deserializes() {
        let raw = r#"{
            "timestamp": 1.25,
            "username": "user",
            "display_name": "User",
            "user_color": null,
            "badges": [],
            "fragments": [{"type": "text", "text": "hello"}],
            "source_platform": "twitch"
        }"#;
        let message: ChatMessage = serde_json::from_str(raw).expect("deserialize old message");
        assert_eq!(message.created_at, None);
        assert_eq!(message.display_name, "User");
    }
}
