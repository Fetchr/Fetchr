pub const APP_CHANNEL: &str = "beta";

pub fn api_base_url() -> Option<String> {
    option_env!("FETCHR_VPS_API_URL")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_end_matches('/').to_string())
}

pub fn telegram_bot_name() -> Option<String> {
    option_env!("FETCHR_TG_BETA_BOT")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .trim_start_matches("https://t.me/")
                .trim_start_matches('@')
                .trim_matches('/')
                .to_string()
        })
        .filter(|value| !value.is_empty())
}

pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn join_api_url(path: &str) -> Option<String> {
    let base = api_base_url()?;
    Some(format!("{base}/{}", path.trim_start_matches('/')))
}
