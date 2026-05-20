use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize)]
pub struct UpdateStatus {
    pub configured: bool,
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub installer_url: Option<String>,
    pub installer_sha256: Option<String>,
    pub size_bytes: Option<u64>,
    pub published_at: Option<String>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct RemoteUpdate {
    #[serde(default)]
    available: Option<bool>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    notes: Option<String>,
    #[serde(default)]
    installer_url: Option<String>,
    #[serde(default)]
    installer_sha256: Option<String>,
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    size_bytes: Option<u64>,
    #[serde(default)]
    published_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallUpdateResult {
    pub installer_path: String,
    pub launched: bool,
}

#[tauri::command]
pub async fn check_for_update() -> Result<UpdateStatus, String> {
    let current_version = crate::remote::app_version();
    let Some(base) = crate::remote::api_base_url() else {
        return Ok(UpdateStatus {
            configured: false,
            available: false,
            current_version,
            version: None,
            notes: None,
            installer_url: None,
            installer_sha256: None,
            size_bytes: None,
            published_at: None,
            message: Some(
                "Update server is not configured. Set FETCHR_VPS_API_URL during build."
                    .to_string(),
            ),
        });
    };

    let url = format!(
        "{base}/updates/latest?platform=windows&channel={}&current_version={}",
        crate::remote::APP_CHANNEL,
        current_version
    );
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|err| format!("Could not create update client: {err}"))?;
    let remote = client
        .get(url)
        .send()
        .await
        .map_err(|err| format!("Could not check update server: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Update server returned an error: {err}"))?
        .json::<RemoteUpdate>()
        .await
        .map_err(|err| format!("Could not parse update response: {err}"))?;

    let version = remote.version.clone();
    let installer_url = remote.installer_url.clone();
    let available = remote.available.unwrap_or_else(|| {
        version
            .as_deref()
            .map(|next| version_is_newer(next, &current_version))
            .unwrap_or(false)
    }) && installer_url
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    Ok(UpdateStatus {
        configured: true,
        available,
        current_version,
        version,
        notes: remote.notes,
        installer_url,
        installer_sha256: remote.installer_sha256.or(remote.sha256),
        size_bytes: remote.size_bytes,
        published_at: remote.published_at,
        message: if available {
            Some("Update is available.".to_string())
        } else {
            Some("Current version is up to date.".to_string())
        },
    })
}

#[tauri::command]
pub async fn install_update(
    installer_url: String,
    installer_sha256: Option<String>,
) -> Result<InstallUpdateResult, String> {
    let parsed = url::Url::parse(installer_url.trim())
        .map_err(|err| format!("Installer URL is invalid: {err}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Installer URL must use http or https.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|err| format!("Could not create download client: {err}"))?;
    let bytes = client
        .get(parsed)
        .send()
        .await
        .map_err(|err| format!("Could not download installer: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Installer server returned an error: {err}"))?
        .bytes()
        .await
        .map_err(|err| format!("Could not read installer bytes: {err}"))?;

    if let Some(expected) = installer_sha256.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual = hex::encode(hasher.finalize());
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "Installer checksum mismatch: expected {expected}, got {actual}"
            ));
        }
    }

    let dir = std::env::temp_dir().join("Fetchr Updates");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|err| format!("Could not create update directory: {err}"))?;
    let path = installer_path(&dir);
    tokio::fs::write(&path, &bytes)
        .await
        .map_err(|err| format!("Could not save installer: {err}"))?;

    Command::new(&path)
        .spawn()
        .map_err(|err| format!("Could not launch installer: {err}"))?;

    Ok(InstallUpdateResult {
        installer_path: path.to_string_lossy().into_owned(),
        launched: true,
    })
}

fn installer_path(dir: &std::path::Path) -> PathBuf {
    let version = crate::remote::app_version()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    dir.join(format!("Fetchr-Setup-update-from-{version}.exe"))
}

fn version_is_newer(candidate: &str, current: &str) -> bool {
    let candidate_parts = parse_version(candidate);
    let current_parts = parse_version(current);

    for index in 0..candidate_parts.len().max(current_parts.len()) {
        let left = *candidate_parts.get(index).unwrap_or(&0);
        let right = *current_parts.get(index).unwrap_or(&0);
        if left > right {
            return true;
        }
        if left < right {
            return false;
        }
    }

    false
}

fn parse_version(value: &str) -> Vec<u64> {
    value
        .trim()
        .trim_start_matches('v')
        .split(['.', '-', '+'])
        .map(|part| {
            part.chars()
                .take_while(|ch| ch.is_ascii_digit())
                .collect::<String>()
        })
        .map(|part| part.parse::<u64>().unwrap_or(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::version_is_newer;

    #[test]
    fn compares_numeric_versions() {
        assert!(version_is_newer("0.2.1", "0.2.0"));
        assert!(version_is_newer("0.10.0", "0.2.9"));
        assert!(!version_is_newer("0.2.0", "0.2.0"));
        assert!(!version_is_newer("0.1.9", "0.2.0"));
    }
}
