use std::{fs, path::PathBuf, process::Command, time::Duration};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const PRODUCT_ID: &str = "fetchr-beta";
const LICENSE_PREFIX: &str = "FTR1";
const PUBLIC_KEY_BASE64: &str = "zWDclah0ZP+GEPf+uWAxdv1ENCglSHdheIVAekWYrfI=";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicensePayload {
    pub v: u8,
    pub product: String,
    pub machine_id: String,
    pub name: Option<String>,
    pub note: Option<String>,
    pub issued_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LicenseStatus {
    pub state: String,
    pub machine_id: String,
    pub license: Option<LicensePayload>,
    pub message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StoredLicense {
    key: String,
}

#[derive(Debug, Serialize)]
struct RemoteLicenseStatusRequest {
    machine_id: String,
    license_key: String,
}

#[derive(Debug, Deserialize)]
struct RemoteLicenseStatus {
    active: bool,
    reason: Option<String>,
    message: Option<String>,
}

#[tauri::command]
pub fn get_machine_id() -> Result<String, String> {
    Ok(current_machine_id())
}

#[derive(Debug, Clone, Serialize)]
pub struct BetaActivationLink {
    pub machine_id: String,
    pub telegram_url: Option<String>,
    pub start_parameter: String,
    pub configured: bool,
    pub message: Option<String>,
}

#[tauri::command]
pub fn beta_activation_link() -> Result<BetaActivationLink, String> {
    let machine_id = current_machine_id();
    let start_parameter = format!("fetchr_{machine_id}");
    let telegram_url = crate::remote::telegram_bot_name()
        .map(|bot| format!("https://t.me/{bot}?start={start_parameter}"));
    let configured = telegram_url.is_some();

    Ok(BetaActivationLink {
        machine_id,
        telegram_url,
        start_parameter,
        configured,
        message: if configured {
            None
        } else {
            Some("Telegram bot is not configured. Set FETCHR_TG_BETA_BOT during build.".to_string())
        },
    })
}

#[tauri::command]
pub async fn license_status() -> Result<LicenseStatus, String> {
    let machine_id = current_machine_id();
    let path = license_file_path()?;

    if !path.is_file() {
        return Ok(LicenseStatus {
            state: "missing".to_string(),
            machine_id,
            license: None,
            message: None,
        });
    }

    let raw =
        fs::read_to_string(&path).map_err(|err| format!("Failed to read license file: {err}"))?;
    let stored: StoredLicense =
        serde_json::from_str(&raw).map_err(|err| format!("Failed to parse license file: {err}"))?;

    let payload = match verify_license_key(&stored.key, &machine_id) {
        Ok(payload) => payload,
        Err(err) => {
            return Ok(LicenseStatus {
                state: "invalid".to_string(),
                machine_id,
                license: None,
                message: Some(err),
            });
        }
    };

    match validate_remote_license(&machine_id, &stored.key).await {
        Ok(Some(remote)) if !remote.active => {
            let _ = fs::remove_file(&path);
            let reason = remote.reason.as_deref().unwrap_or("unknown");
            Ok(LicenseStatus {
                state: "invalid".to_string(),
                machine_id,
                license: None,
                message: Some(remote.message.unwrap_or_else(|| {
                    format!("License is no longer active ({reason}). Subscribe to the official Telegram channel and request a new key.")
                })),
            })
        }
        Ok(_) => Ok(LicenseStatus {
            state: "active".to_string(),
            machine_id,
            license: Some(payload),
            message: None,
        }),
        Err(err) => Ok(LicenseStatus {
            state: "invalid".to_string(),
            machine_id,
            license: None,
            message: Some(err),
        }),
    }
}

#[tauri::command]
pub async fn activate_license(key: String) -> Result<LicenseStatus, String> {
    let machine_id = current_machine_id();
    let normalized = normalize_key(&key);
    let payload = verify_license_key(&normalized, &machine_id)?;
    let path = license_file_path()?;

    if let Some(remote) = validate_remote_license(&machine_id, &normalized).await? {
        if !remote.active {
            let reason = remote.reason.as_deref().unwrap_or("unknown");
            return Err(remote.message.unwrap_or_else(|| {
                format!("License is not active ({reason}). Subscribe to the official Telegram channel and request a new key.")
            }));
        }
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create license directory: {err}"))?;
    }

    let stored = StoredLicense { key: normalized };
    let raw = serde_json::to_string_pretty(&stored)
        .map_err(|err| format!("Failed to serialize license: {err}"))?;
    fs::write(&path, raw).map_err(|err| format!("Failed to save license: {err}"))?;

    Ok(LicenseStatus {
        state: "active".to_string(),
        machine_id,
        license: Some(payload),
        message: None,
    })
}

async fn validate_remote_license(
    machine_id: &str,
    license_key: &str,
) -> Result<Option<RemoteLicenseStatus>, String> {
    let Some(base) = crate::remote::api_base_url() else {
        return Ok(None);
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|err| format!("Could not create license client: {err}"))?;
    let response = client
        .post(format!("{base}/license/status"))
        .json(&RemoteLicenseStatusRequest {
            machine_id: machine_id.to_string(),
            license_key: license_key.to_string(),
        })
        .send()
        .await
        .map_err(|err| format!("Could not check beta access: {err}"))?
        .error_for_status()
        .map_err(|err| format!("Beta access server returned an error: {err}"))?
        .json::<RemoteLicenseStatus>()
        .await
        .map_err(|err| format!("Could not parse beta access response: {err}"))?;

    Ok(Some(response))
}

#[tauri::command]
pub fn reset_license() -> Result<LicenseStatus, String> {
    let machine_id = current_machine_id();
    let path = license_file_path()?;

    if path.is_file() {
        fs::remove_file(&path).map_err(|err| format!("Failed to remove license: {err}"))?;
    }

    Ok(LicenseStatus {
        state: "missing".to_string(),
        machine_id,
        license: None,
        message: None,
    })
}

fn verify_license_key(key: &str, machine_id: &str) -> Result<LicensePayload, String> {
    let normalized = normalize_key(key);
    if normalized.is_empty() {
        return Err("License key is empty".to_string());
    }

    let mut parts = normalized.split('.');
    let prefix = parts.next().unwrap_or_default();
    let payload_part = parts.next().unwrap_or_default();
    let signature_part = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || prefix != LICENSE_PREFIX
        || payload_part.is_empty()
        || signature_part.is_empty()
    {
        return Err("License key format is invalid".to_string());
    }

    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_part)
        .map_err(|_| "License payload is not valid base64".to_string())?;
    let signature_bytes = URL_SAFE_NO_PAD
        .decode(signature_part)
        .map_err(|_| "License signature is not valid base64".to_string())?;

    let public_key_bytes = base64::engine::general_purpose::STANDARD
        .decode(PUBLIC_KEY_BASE64)
        .map_err(|_| "Embedded public key is invalid".to_string())?;
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| "Embedded public key has invalid length".to_string())?;
    let verifying_key = VerifyingKey::from_bytes(&public_key_array)
        .map_err(|_| "Embedded public key cannot be loaded".to_string())?;
    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|_| "License signature has invalid length".to_string())?;

    verifying_key
        .verify(payload_part.as_bytes(), &signature)
        .map_err(|_| "License signature does not match".to_string())?;

    let payload: LicensePayload = serde_json::from_slice(&payload_bytes)
        .map_err(|_| "License payload JSON is invalid".to_string())?;

    if payload.v != 1 {
        return Err("License version is unsupported".to_string());
    }
    if payload.product != PRODUCT_ID {
        return Err("License is for a different product".to_string());
    }
    if payload.machine_id != machine_id {
        return Err("License is bound to another computer".to_string());
    }

    Ok(payload)
}

fn normalize_key(key: &str) -> String {
    key.chars().filter(|ch| !ch.is_whitespace()).collect()
}

fn license_file_path() -> Result<PathBuf, String> {
    let base = dirs::config_dir()
        .ok_or_else(|| "Could not locate Windows config directory".to_string())?;
    Ok(base.join("Fetchr").join("license.json"))
}

pub(crate) fn current_machine_id() -> String {
    compute_machine_id()
}

fn compute_machine_id() -> String {
    let mut parts = Vec::new();

    #[cfg(target_os = "windows")]
    {
        push_if_some(&mut parts, "machine_guid", windows_registry_machine_guid());
        push_if_some(
            &mut parts,
            "bios_serial",
            powershell_first_line(
                "Get-CimInstance Win32_BIOS | Select-Object -ExpandProperty SerialNumber",
            ),
        );
        push_if_some(
            &mut parts,
            "baseboard_serial",
            powershell_first_line(
                "Get-CimInstance Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber",
            ),
        );
        push_if_some(
            &mut parts,
            "computer_uuid",
            powershell_first_line(
                "Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID",
            ),
        );
    }

    push_if_some(
        &mut parts,
        "computer_name",
        std::env::var("COMPUTERNAME").ok(),
    );
    push_if_some(&mut parts, "user_domain", std::env::var("USERDOMAIN").ok());

    if parts.is_empty() {
        push_if_some(&mut parts, "fallback", std::env::var("USERNAME").ok());
    }

    parts.sort();
    let joined = parts.join("|");
    let mut hasher = Sha256::new();
    hasher.update(PRODUCT_ID.as_bytes());
    hasher.update(b"|");
    hasher.update(joined.as_bytes());
    let digest = hasher.finalize();
    hex::encode(digest)[..32].to_ascii_uppercase()
}

fn push_if_some(parts: &mut Vec<String>, label: &str, value: Option<String>) {
    if let Some(value) = value {
        let trimmed = value.trim();
        if !trimmed.is_empty()
            && trimmed != "To be filled by O.E.M."
            && trimmed != "Default string"
            && trimmed != "System Serial Number"
        {
            parts.push(format!("{label}={trimmed}"));
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_registry_machine_guid() -> Option<String> {
    let output = hidden_command("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find_map(|line| {
        if !line.contains("MachineGuid") {
            return None;
        }
        let columns = line.split_whitespace().collect::<Vec<_>>();
        columns.last().map(|value| (*value).to_string())
    })
}

#[cfg(target_os = "windows")]
fn powershell_first_line(command: &str) -> Option<String> {
    let output = hidden_command("powershell")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            command,
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(target_os = "windows")]
fn hidden_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let mut cmd = Command::new(program);
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    const MACHINE_ID: &str = "0123456789ABCDEF0123456789ABCDEF";
    const VALID_KEY: &str = "FTR1.eyJ2IjoxLCJwcm9kdWN0IjoiZmV0Y2hyLWJldGEiLCJtYWNoaW5lX2lkIjoiMDEyMzQ1Njc4OUFCQ0RFRjAxMjM0NTY3ODlBQkNERUYiLCJuYW1lIjoiU21va2UgVGVzdGVyIiwibm90ZSI6bnVsbCwiaXNzdWVkX2F0IjoiMjAyNi0wNS0xN1QyMDo1NDozNC4zNzFaIn0.hMS3JlIrFBYSMk9TgzMTaeG_qrFs8sCR_-HV83JRX4oD-4eMO_P68pEmZWtxLZWULzY7nPYFe9Ponr2SI-I_Cw";

    #[test]
    fn accepts_signed_key_for_matching_machine() {
        let payload = verify_license_key(VALID_KEY, MACHINE_ID).expect("valid key");
        assert_eq!(payload.product, PRODUCT_ID);
        assert_eq!(payload.machine_id, MACHINE_ID);
    }

    #[test]
    fn rejects_signed_key_for_other_machine() {
        let err =
            verify_license_key(VALID_KEY, "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF").expect_err("bad id");
        assert!(err.contains("another computer"));
    }
}
