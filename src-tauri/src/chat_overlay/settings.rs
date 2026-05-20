use serde::{Deserialize, Serialize};

use crate::jobs::types::{
    AlphaOutputFormat, ChatComposeMode, ChatFontStyle, ChatOverlayMode, ChatOverlaySettings,
    ChatRenderCodec, FinalRenderMode,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectiveChatOverlaySettings {
    pub enabled: bool,
    pub mode: ChatOverlayMode,
    pub output_width: u32,
    pub output_height: u32,
    pub fps: u32,
    pub chat_x: i32,
    pub chat_y: i32,
    pub chat_width: u32,
    pub chat_height: u32,
    pub font_family: String,
    pub font_weight: u16,
    pub font_style: ChatFontStyle,
    pub username_font_weight: u16,
    pub username_font_style: ChatFontStyle,
    pub font_size: f32,
    pub text_color: String,
    pub outline_enabled: bool,
    pub outline_color: String,
    pub outline_thickness: u32,
    pub background_enabled: bool,
    pub background_opacity: f32,
    pub show_badges: bool,
    pub show_timestamps: bool,
    pub show_avatars: bool,
    pub show_bttv: bool,
    pub show_ffz: bool,
    pub show_7tv: bool,
    pub max_visible_messages: usize,
    pub message_lifetime_sec: f64,
    pub chat_update_rate_sec: f64,
    pub direction: String,
    pub alpha_output_format: AlphaOutputFormat,
    pub chat_overlay_fps: u32,
    pub save_alpha_overlay: bool,
    pub save_clean_video: bool,
    pub compose_mode: ChatComposeMode,
    pub render_codec: ChatRenderCodec,
    pub final_render_mode: FinalRenderMode,
    pub solid_background_color: String,
}

impl From<ChatOverlaySettings> for EffectiveChatOverlaySettings {
    fn from(settings: ChatOverlaySettings) -> Self {
        let s = settings.with_defaults();
        let mut output_width = s.output_width.unwrap_or(1920).max(1);
        let mut output_height = s.output_height.unwrap_or(1080).max(1);
        if output_width < output_height {
            std::mem::swap(&mut output_width, &mut output_height);
        }
        let chat_width = s.chat_width.unwrap_or(1760).max(1).min(output_width);
        let chat_height = s.chat_height.unwrap_or(260).max(1).min(output_height);
        let chat_x = s
            .chat_x
            .unwrap_or(80)
            .clamp(0, output_width.saturating_sub(chat_width) as i32);
        let chat_y = s
            .chat_y
            .unwrap_or(760)
            .clamp(0, output_height.saturating_sub(chat_height) as i32);
        Self {
            enabled: s.enabled.unwrap_or(false),
            mode: s.mode.unwrap_or(ChatOverlayMode::TransparentOverlay),
            output_width,
            output_height,
            fps: s.fps.unwrap_or(60).clamp(1, 240),
            chat_x,
            chat_y,
            chat_width,
            chat_height,
            font_family: s.font_family.unwrap_or_else(|| "Inter".to_string()),
            font_weight: s.font_weight.unwrap_or(400).clamp(100, 900),
            font_style: s.font_style.unwrap_or(ChatFontStyle::Normal),
            username_font_weight: s.username_font_weight.unwrap_or(700).clamp(100, 900),
            username_font_style: s.username_font_style.unwrap_or(ChatFontStyle::Normal),
            font_size: s.font_size.unwrap_or(24.0).max(6.0),
            text_color: s.text_color.unwrap_or_else(|| "#FFFFFF".to_string()),
            outline_enabled: s.outline_enabled.unwrap_or(true),
            outline_color: s.outline_color.unwrap_or_else(|| "#000000".to_string()),
            outline_thickness: s.outline_thickness.unwrap_or(2),
            background_enabled: s.background_enabled.unwrap_or(false),
            background_opacity: s.background_opacity.unwrap_or(0.15).clamp(0.0, 1.0),
            show_badges: s.show_badges.unwrap_or(true),
            show_timestamps: s.show_timestamps.unwrap_or(false),
            show_avatars: s.show_avatars.unwrap_or(false),
            show_bttv: s.show_bttv.unwrap_or(true),
            show_ffz: s.show_ffz.unwrap_or(true),
            show_7tv: s.show_7tv.unwrap_or(true),
            max_visible_messages: s.max_visible_messages.unwrap_or(14).max(1) as usize,
            message_lifetime_sec: s.message_lifetime_sec.unwrap_or(86400.0).max(0.1),
            chat_update_rate_sec: s.chat_update_rate_sec.unwrap_or(0.2).clamp(0.0, 10.0),
            direction: s.direction.unwrap_or_else(|| "bottom-up".to_string()),
            alpha_output_format: s.alpha_output_format.unwrap_or(AlphaOutputFormat::MovQtrle),
            chat_overlay_fps: s
                .chat_overlay_fps
                .unwrap_or_else(|| s.fps.unwrap_or(60))
                .clamp(1, 240),
            save_alpha_overlay: s.save_alpha_overlay.unwrap_or(true),
            save_clean_video: s.save_clean_video.unwrap_or(true),
            compose_mode: s.compose_mode.unwrap_or(ChatComposeMode::Direct),
            render_codec: s.render_codec.unwrap_or(ChatRenderCodec::RawRgbaPipe),
            final_render_mode: s.final_render_mode.unwrap_or(FinalRenderMode::Full),
            solid_background_color: s
                .solid_background_color
                .unwrap_or_else(|| "#212121".to_string()),
        }
    }
}

pub fn parse_color(value: &str, fallback: [u8; 4]) -> [u8; 4] {
    let raw = value.trim().trim_start_matches('#');
    if raw.len() != 6 && raw.len() != 8 {
        return fallback;
    }
    let r = u8::from_str_radix(&raw[0..2], 16).unwrap_or(fallback[0]);
    let g = u8::from_str_radix(&raw[2..4], 16).unwrap_or(fallback[1]);
    let b = u8::from_str_radix(&raw[4..6], 16).unwrap_or(fallback[2]);
    let a = if raw.len() == 8 {
        u8::from_str_radix(&raw[6..8], 16).unwrap_or(fallback[3])
    } else {
        fallback[3]
    };
    [r, g, b, a]
}
