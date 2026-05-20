use serde::{Deserialize, Serialize};

/// Proxy configuration normalised into an explicit scheme.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxyConfig {
    pub enabled: bool,
    /// Raw URL as provided by the user: e.g. "127.0.0.1:2080", "http://...",
    /// "socks5://...", "socks5h://user:pass@host:port".
    pub url: String,
}

impl ProxyConfig {
    /// Return an absolute proxy URL with explicit scheme, suitable for passing to
    /// yt-dlp, N_m3u8DL-RE and environment variables.
    ///
    /// Rules:
    /// - If url is empty or proxy is disabled → None.
    /// - If scheme is missing → default to "http://".
    /// - Accept http, https, socks4, socks5, socks5h as known schemes.
    pub fn resolved(&self) -> Option<String> {
        if !self.enabled {
            return None;
        }
        let raw = self.url.trim();
        if raw.is_empty() {
            return None;
        }
        if raw.contains("://") {
            Some(raw.to_string())
        } else {
            Some(format!("http://{raw}"))
        }
    }

    /// Translate the proxy URL into the form yt-dlp expects for `--proxy`.
    /// yt-dlp natively supports socks5://, so we pass it through unchanged.
    pub fn for_ytdlp(&self) -> Option<String> {
        self.resolved()
    }

    /// N_m3u8DL-RE expects http(s) proxy only. For socks5 we return the URL
    /// unchanged — the latest versions understand it; older versions will
    /// simply ignore and the caller should fall back to yt-dlp for the
    /// segment fetch.
    pub fn for_n_m3u8dl(&self) -> Option<String> {
        self.resolved()
    }
}
