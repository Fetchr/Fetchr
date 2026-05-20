use std::collections::HashMap;

use ab_glyph::{Font, FontArc, PxScale, PxScaleFont, ScaleFont};

use crate::chat_overlay::model::{ChatFragment, ChatMessage};
use crate::chat_overlay::settings::{parse_color, EffectiveChatOverlaySettings};

#[derive(Debug, Clone)]
pub enum LayoutRunKind {
    Text {
        text: String,
        role: TextRole,
    },
    Image {
        provider: String,
        id: String,
        url: String,
        placeholder: String,
        is_badge: bool,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TextRole {
    Text,
    Username,
}

#[derive(Debug, Clone)]
pub struct LayoutRun {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
    pub color: [u8; 4],
    pub kind: LayoutRunKind,
}

#[derive(Debug, Clone)]
pub struct LayoutMessage {
    pub height: u32,
    pub runs: Vec<LayoutRun>,
}

pub struct ChatLayoutEngine {
    cache: HashMap<String, LayoutMessage>,
    image_dimensions: HashMap<String, (u32, u32)>,
    settings: EffectiveChatOverlaySettings,
}

#[derive(Debug, Clone)]
enum Token {
    Text(String, [u8; 4], TextRole),
    Image {
        provider: String,
        id: String,
        url: String,
        placeholder: String,
        is_badge: bool,
        zero_width: bool,
        width: i32,
        height: i32,
    },
}

impl ChatLayoutEngine {
    pub fn new(settings: EffectiveChatOverlaySettings) -> Self {
        Self {
            cache: HashMap::new(),
            image_dimensions: HashMap::new(),
            settings,
        }
    }

    pub fn set_image_dimensions(&mut self, dimensions: HashMap<String, (u32, u32)>) {
        if self.image_dimensions != dimensions {
            self.cache.clear();
            self.image_dimensions = dimensions;
        }
    }

    pub fn layout_message(
        &mut self,
        message: &ChatMessage,
        text_font: &FontArc,
        username_font: &FontArc,
    ) -> LayoutMessage {
        let key = format!(
            "{}|{}|{}|{}|{}",
            message.stable_key(),
            self.settings.chat_width,
            self.settings.font_size,
            self.settings.show_badges,
            self.settings.show_timestamps
        );
        if let Some(layout) = self.cache.get(&key) {
            return layout.clone();
        }

        let layout = self.compute_message(message, text_font, username_font);
        self.cache.insert(key, layout.clone());
        layout
    }

    fn compute_message(
        &self,
        message: &ChatMessage,
        text_font: &FontArc,
        username_font: &FontArc,
    ) -> LayoutMessage {
        let scale = PxScale::from(self.settings.font_size);
        let scaled_text = text_font.as_scaled(scale);
        let scaled_username = username_font.as_scaled(scale);
        let line_height = (self.settings.font_size * 1.28).ceil() as i32;
        let image_size = (self.settings.font_size * 1.05).ceil() as i32;
        let badge_size = (self.settings.font_size * 0.72).ceil() as i32;
        let gap = 4;
        let padding_x = 2_i32;
        let max_width = (self.settings.chat_width as i32 - padding_x * 2).max(1);
        let text_color = parse_color(&self.settings.text_color, [255, 255, 255, 255]);
        let name_color = message
            .user_color
            .as_deref()
            .map(|c| ensure_readable_name_color(parse_color(c, [160, 200, 255, 255])))
            .unwrap_or([160, 200, 255, 255]);
        let timestamp_color = [190, 190, 190, 255];

        let mut tokens = Vec::new();
        if self.settings.show_timestamps {
            tokens.push(Token::Text(
                format!("[{}] ", format_timestamp(message.timestamp)),
                timestamp_color,
                TextRole::Text,
            ));
        }
        if self.settings.show_badges {
            for badge in &message.badges {
                if let Some(url) = badge.url.clone() {
                    let (width, height) = self.image_slot_dimensions(
                        &badge.provider,
                        &badge.id,
                        &url,
                        true,
                        badge_size,
                        badge_size,
                    );
                    tokens.push(Token::Image {
                        provider: badge.provider.clone(),
                        id: badge.id.clone(),
                        url,
                        placeholder: badge.title.clone().unwrap_or_else(|| badge.id.clone()),
                        is_badge: true,
                        zero_width: false,
                        width,
                        height,
                    });
                }
            }
        }
        tokens.push(Token::Text(
            format!("{}: ", message.display_name),
            name_color,
            TextRole::Username,
        ));
        for fragment in &message.fragments {
            match fragment {
                ChatFragment::Text { text } => {
                    for part in split_preserve_spaces(text) {
                        tokens.push(Token::Text(part, text_color, TextRole::Text));
                    }
                }
                ChatFragment::Emote {
                    provider,
                    id,
                    url,
                    text,
                    zero_width,
                } => {
                    let default_width = (image_size as f32 * 1.35).ceil() as i32;
                    let (width, height) = self.image_slot_dimensions(
                        provider,
                        id,
                        url,
                        false,
                        default_width,
                        image_size,
                    );
                    tokens.push(Token::Image {
                        provider: provider.clone(),
                        id: id.clone(),
                        url: url.clone(),
                        placeholder: text.clone().unwrap_or_else(|| id.clone()),
                        is_badge: false,
                        zero_width: *zero_width,
                        width,
                        height,
                    });
                }
            }
        }

        let mut runs = Vec::new();
        let mut x = padding_x;
        let mut y = 0;
        let mut line_max_height = line_height;

        for token in tokens {
            match token {
                Token::Text(text, color, role) => {
                    let scaled = if role == TextRole::Username {
                        &scaled_username
                    } else {
                        &scaled_text
                    };
                    for chunk in split_long_token(&text, max_width, scaled) {
                        let width = measure_text(scaled, &chunk).ceil() as i32;
                        if x > padding_x
                            && !chunk.trim().is_empty()
                            && x + width > max_width + padding_x
                        {
                            x = padding_x;
                            y += line_max_height;
                            line_max_height = line_height;
                        }
                        if chunk == " " && x == padding_x {
                            continue;
                        }
                        runs.push(LayoutRun {
                            x,
                            y,
                            width,
                            height: line_height,
                            color,
                            kind: LayoutRunKind::Text { text: chunk, role },
                        });
                        x += width;
                    }
                }
                Token::Image {
                    provider,
                    id,
                    url,
                    placeholder,
                    is_badge,
                    zero_width,
                    width,
                    height,
                } => {
                    let draw_x = if zero_width {
                        (x - width - gap).max(padding_x)
                    } else {
                        x
                    };
                    if !zero_width && x > padding_x && x + width > max_width + padding_x {
                        x = padding_x;
                        y += line_max_height;
                        line_max_height = line_height;
                    }
                    runs.push(LayoutRun {
                        x: draw_x,
                        y: y + ((line_height - height) / 2),
                        width,
                        height,
                        color: text_color,
                        kind: LayoutRunKind::Image {
                            provider,
                            id,
                            url,
                            placeholder,
                            is_badge,
                        },
                    });
                    if !zero_width {
                        x += width + gap;
                    }
                    line_max_height = line_max_height.max(height);
                }
            }
        }

        let height = (y + line_max_height).max(line_height) as u32;
        LayoutMessage { height, runs }
    }

    fn image_slot_dimensions(
        &self,
        provider: &str,
        id: &str,
        url: &str,
        is_badge: bool,
        fallback_width: i32,
        fallback_height: i32,
    ) -> (i32, i32) {
        let height = fallback_height.max(1);
        let key = image_dimension_key(provider, id, url, is_badge);
        let width = self
            .image_dimensions
            .get(&key)
            .map(|(w, h)| {
                let aspect = *w as f32 / (*h).max(1) as f32;
                (height as f32 * aspect).round() as i32
            })
            .unwrap_or(fallback_width)
            .clamp(1, height * 4);
        (width, height)
    }
}

pub fn image_dimension_key(provider: &str, id: &str, url: &str, is_badge: bool) -> String {
    let kind = if is_badge { "badge" } else { "emote" };
    format!("{kind}:{provider}:{id}:{url}")
}

fn measure_text(font: &PxScaleFont<&FontArc>, text: &str) -> f32 {
    text.chars()
        .map(|ch| font.h_advance(font.glyph_id(ch)))
        .sum::<f32>()
}

fn split_preserve_spaces(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut last_space: Option<bool> = None;
    for ch in text.chars() {
        let is_space = ch.is_whitespace();
        if let Some(prev) = last_space {
            if prev != is_space && !buf.is_empty() {
                out.push(std::mem::take(&mut buf));
            }
        }
        buf.push(ch);
        last_space = Some(is_space);
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

fn split_long_token(text: &str, max_width: i32, font: &PxScaleFont<&FontArc>) -> Vec<String> {
    if measure_text(font, text) <= max_width as f32 {
        return vec![text.to_string()];
    }
    let mut out = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        let candidate = format!("{current}{ch}");
        if !current.is_empty() && measure_text(font, &candidate) > max_width as f32 {
            out.push(std::mem::take(&mut current));
        }
        current.push(ch);
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}

fn format_timestamp(seconds: f64) -> String {
    let total = seconds.max(0.0).floor() as u64;
    let h = total / 3600;
    let m = (total % 3600) / 60;
    let s = total % 60;
    if h > 0 {
        format!("{h:02}:{m:02}:{s:02}")
    } else {
        format!("{m:02}:{s:02}")
    }
}

fn ensure_readable_name_color(color: [u8; 4]) -> [u8; 4] {
    let luminance = 0.2126 * color[0] as f32 + 0.7152 * color[1] as f32 + 0.0722 * color[2] as f32;
    if luminance < 95.0 {
        [150, 210, 255, color[3]]
    } else {
        color
    }
}
