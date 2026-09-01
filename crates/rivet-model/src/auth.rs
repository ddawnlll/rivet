//! # rivet-model::auth
//!
//! OpenCode-compatible Auth & Secret Store for Rivet.
//! Securely persists provider credentials and custom endpoints to
//! `~/.local/share/rivet/auth.json` with `0o600` (user-only) permissions.

use rivet_types::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuthInfo {
    #[serde(rename = "api")]
    Api {
        key: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        base_url: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default_model: Option<String>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        models: Vec<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        metadata: Option<HashMap<String, String>>,
    },
    #[serde(rename = "oauth")]
    OAuth {
        refresh: String,
        access: String,
        expires: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        account_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        enterprise_url: Option<String>,
    },
    #[serde(rename = "wellknown")]
    WellKnown { key: String, token: String },
}

impl AuthInfo {
    pub fn api_key(&self) -> &str {
        match self {
            AuthInfo::Api { key, .. } => key.as_str(),
            AuthInfo::OAuth { access, .. } => access.as_str(),
            AuthInfo::WellKnown { token, .. } => token.as_str(),
        }
    }

    pub fn base_url(&self) -> Option<&str> {
        match self {
            AuthInfo::Api { base_url, .. } => base_url.as_deref(),
            _ => None,
        }
    }

    pub fn default_model(&self) -> Option<&str> {
        match self {
            AuthInfo::Api { default_model, .. } => default_model.as_deref(),
            _ => None,
        }
    }

    pub fn models(&self) -> &[String] {
        match self {
            AuthInfo::Api { models, .. } => models.as_slice(),
            _ => &[],
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_model: Option<String>,
    #[serde(default)]
    pub providers: HashMap<String, AuthInfo>,
}

#[derive(Debug, Clone)]
pub struct AuthStore {
    path: PathBuf,
}

impl Default for AuthStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AuthStore {
    pub fn new() -> Self {
        Self {
            path: Self::default_auth_path(),
        }
    }

    pub fn with_path(path: impl Into<PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// Determines standard data directory (~/.local/share/rivet/auth.json or ~/.config/rivet/auth.json)
    pub fn default_auth_path() -> PathBuf {
        if let Ok(override_path) = std::env::var("RIVET_AUTH_PATH") {
            return PathBuf::from(override_path);
        }

        #[cfg(windows)]
        {
            if let Ok(appdata) = std::env::var("LOCALAPPDATA").or_else(|_| std::env::var("APPDATA"))
            {
                return Path::new(&appdata).join("rivet").join("auth.json");
            }
            if let Ok(userprofile) = std::env::var("USERPROFILE") {
                return Path::new(&userprofile)
                    .join(".config")
                    .join("rivet")
                    .join("auth.json");
            }
        }

        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            let local_share = Path::new(&home).join(".local").join("share").join("rivet");
            if local_share.exists() {
                return local_share.join("auth.json");
            }
            let config_dir = Path::new(&home).join(".config").join("rivet");
            return config_dir.join("auth.json");
        }

        PathBuf::from(".rivet-auth.json")
    }

    /// Read raw AuthData from environment variable or file
    pub fn load(&self) -> RivetResult<AuthData> {
        if let Ok(content) =
            std::env::var("RIVET_AUTH_CONTENT").or_else(|_| std::env::var("OPENCODE_AUTH_CONTENT"))
        {
            if let Ok(data) = serde_json::from_str::<AuthData>(&content) {
                return Ok(data);
            }
            if let Ok(providers) = serde_json::from_str::<HashMap<String, AuthInfo>>(&content) {
                return Ok(AuthData {
                    active_provider: None,
                    active_model: None,
                    providers,
                });
            }
        }

        let file_path = if self.path.exists() {
            Some(self.path.clone())
        } else {
            let mut candidates = Vec::new();
            if let Ok(userprofile) = std::env::var("USERPROFILE") {
                candidates.push(
                    Path::new(&userprofile)
                        .join(".local")
                        .join("share")
                        .join("opencode")
                        .join("auth.json"),
                );
                candidates.push(
                    Path::new(&userprofile)
                        .join(".config")
                        .join("opencode")
                        .join("auth.json"),
                );
            }
            if let Ok(home) = std::env::var("HOME") {
                candidates.push(
                    Path::new(&home)
                        .join(".local")
                        .join("share")
                        .join("opencode")
                        .join("auth.json"),
                );
                candidates.push(
                    Path::new(&home)
                        .join(".config")
                        .join("opencode")
                        .join("auth.json"),
                );
            }
            candidates.into_iter().find(|p| p.exists())
        };

        let Some(path) = file_path else {
            return Ok(AuthData::default());
        };

        let mut file = File::open(&path)
            .map_err(|e| RivetError::Storage(format!("failed to open auth file: {e}")))?;
        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| RivetError::Storage(format!("failed to read auth file: {e}")))?;

        if content.trim().is_empty() {
            return Ok(AuthData::default());
        }

        let mut auth_data = if let Ok(data) = serde_json::from_str::<AuthData>(&content) {
            data
        } else if let Ok(providers) = serde_json::from_str::<HashMap<String, AuthInfo>>(&content) {
            AuthData {
                active_provider: None,
                active_model: None,
                providers,
            }
        } else {
            AuthData::default()
        };

        // Normalize and populate default base_url for opencode / opencode-go if present
        if let Some(opencode_info) = auth_data
            .providers
            .remove("opencode-go")
            .or_else(|| auth_data.providers.remove("opencode_go"))
        {
            let api_key = opencode_info.api_key().to_string();
            let base_url = opencode_info
                .base_url()
                .map(str::to_string)
                .or_else(|| Some("https://opencode.ai/zen/go/v1".into()));
            let def_model = opencode_info
                .default_model()
                .map(str::to_string)
                .or_else(|| Some("mimo-v2.5".into()));
            let models = if opencode_info.models().is_empty() {
                vec!["mimo-v2.5".into(), "muse-spark-1.2-contributor-free".into()]
            } else {
                opencode_info.models().to_vec()
            };
            auth_data.providers.insert(
                "opencode".into(),
                AuthInfo::Api {
                    key: api_key,
                    base_url,
                    default_model: def_model,
                    models,
                    metadata: None,
                },
            );
            if auth_data.active_provider.as_deref() == Some("opencode-go")
                || auth_data.active_provider.is_none()
            {
                auth_data.active_provider = Some("opencode".into());
                auth_data.active_model = Some("mimo-v2.5".into());
            }
        }

        Ok(auth_data)
    }

    /// Save AuthData with strict 0o600 permissions
    pub fn save(&self, data: &AuthData) -> RivetResult<()> {
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let serialized = serde_json::to_string_pretty(data)
            .map_err(|e| RivetError::Serialization(e.to_string()))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            let mut file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .mode(0o600)
                .open(&self.path)
                .map_err(|e| RivetError::Storage(format!("failed to write auth file: {e}")))?;
            file.write_all(serialized.as_bytes())
                .map_err(|e| RivetError::Storage(format!("failed to write auth bytes: {e}")))?;
        }

        #[cfg(not(unix))]
        {
            let mut file = OpenOptions::new()
                .create(true)
                .write(true)
                .truncate(true)
                .open(&self.path)
                .map_err(|e| RivetError::Storage(format!("failed to write auth file: {e}")))?;
            file.write_all(serialized.as_bytes())
                .map_err(|e| RivetError::Storage(format!("failed to write auth bytes: {e}")))?;
        }

        Ok(())
    }

    pub fn all(&self) -> RivetResult<HashMap<String, AuthInfo>> {
        Ok(self.load()?.providers)
    }

    pub fn get(&self, provider_id: &str) -> RivetResult<Option<AuthInfo>> {
        let norm = normalize_provider_id(provider_id);
        Ok(self.load()?.providers.get(&norm).cloned())
    }

    pub fn get_api_key(&self, provider_id: &str) -> RivetResult<Option<String>> {
        if let Some(info) = self.get(provider_id)? {
            return Ok(Some(info.api_key().to_string()));
        }
        Ok(None)
    }

    pub fn get_base_url(&self, provider_id: &str) -> RivetResult<Option<String>> {
        if let Some(info) = self.get(provider_id)? {
            return Ok(info.base_url().map(str::to_string));
        }
        Ok(None)
    }

    pub fn get_models(&self, provider_id: &str) -> RivetResult<Vec<String>> {
        if let Some(info) = self.get(provider_id)? {
            return Ok(info.models().to_vec());
        }
        Ok(Vec::new())
    }

    pub fn set(&self, provider_id: &str, info: AuthInfo) -> RivetResult<()> {
        let norm = normalize_provider_id(provider_id);
        let mut data = self.load()?;
        data.providers.insert(norm.clone(), info);
        if data.active_provider.is_none() {
            data.active_provider = Some(norm);
        }
        self.save(&data)
    }

    pub fn set_api_key(&self, provider_id: &str, key: &str) -> RivetResult<()> {
        let current_base = self.get_base_url(provider_id).unwrap_or(None);
        let current_models = self.get_models(provider_id).unwrap_or_default();
        let current_default = self
            .get(provider_id)
            .ok()
            .flatten()
            .and_then(|i| i.default_model().map(str::to_string));

        self.set(
            provider_id,
            AuthInfo::Api {
                key: key.to_string(),
                base_url: current_base,
                default_model: current_default,
                models: current_models,
                metadata: None,
            },
        )
    }

    pub fn set_provider_config(
        &self,
        provider_id: &str,
        key: &str,
        base_url: Option<&str>,
        default_model: Option<&str>,
        models: Vec<String>,
    ) -> RivetResult<()> {
        self.set(
            provider_id,
            AuthInfo::Api {
                key: key.to_string(),
                base_url: base_url.map(str::to_string),
                default_model: default_model.map(str::to_string),
                models,
                metadata: None,
            },
        )
    }

    pub fn save_models_for_provider(
        &self,
        provider_id: &str,
        models: Vec<String>,
    ) -> RivetResult<()> {
        let norm = normalize_provider_id(provider_id);
        let mut data = self.load()?;
        if let Some(AuthInfo::Api { models: m, .. }) = data.providers.get_mut(&norm) {
            *m = models;
        }
        self.save(&data)
    }

    pub fn remove(&self, provider_id: &str) -> RivetResult<bool> {
        let norm = normalize_provider_id(provider_id);
        let mut data = self.load()?;
        let existed = data.providers.remove(&norm).is_some();
        if data.active_provider.as_deref() == Some(&norm) {
            data.active_provider = data.providers.keys().next().cloned();
        }
        self.save(&data)?;
        Ok(existed)
    }

    pub fn get_active_provider(&self) -> RivetResult<Option<String>> {
        Ok(self.load()?.active_provider)
    }

    pub fn set_active_provider(&self, provider_id: &str) -> RivetResult<()> {
        let norm = normalize_provider_id(provider_id);
        let mut data = self.load()?;
        data.active_provider = Some(norm);
        self.save(&data)
    }

    pub fn get_active_model(&self) -> RivetResult<Option<String>> {
        Ok(self.load()?.active_model)
    }

    pub fn set_active_model(&self, model_id: &str) -> RivetResult<()> {
        let mut data = self.load()?;
        data.active_model = Some(model_id.trim().to_string());
        self.save(&data)
    }

    /// Mask an API key for safe display (e.g. `sk-proj-1234567890` -> `sk-proj-...7890`)
    pub fn mask_key(key: &str) -> String {
        let chars: Vec<char> = key.chars().collect();
        let len = chars.len();
        if len <= 8 {
            return "***".to_string();
        }
        let prefix_len = if len > 16 { 7 } else { 4 };
        let suffix_len = if len > 16 { 4 } else { 3 };
        let prefix: String = chars[..prefix_len].iter().collect();
        let suffix: String = chars[len - suffix_len..].iter().collect();
        format!("{prefix}...{suffix}")
    }
}

pub fn normalize_provider_id(id: &str) -> String {
    id.trim().trim_end_matches('/').to_lowercase()
}

pub use secrecy::{ExposeSecret, SecretString};
pub use zeroize::{Zeroize, ZeroizeOnDrop};

/// Abstract credential store for production secret management across OS Keyrings and CI environments.
pub trait CredentialStore: Send + Sync {
    fn get_credential(&self, service: &str, key: &str) -> RivetResult<Option<SecretString>>;
    fn set_credential(&self, service: &str, key: &str, secret: &str) -> RivetResult<()>;
    fn delete_credential(&self, service: &str, key: &str) -> RivetResult<bool>;
}

pub struct KeyringCredentialStore;

impl KeyringCredentialStore {
    pub fn new() -> Self {
        Self
    }
}

impl Default for KeyringCredentialStore {
    fn default() -> Self {
        Self::new()
    }
}

impl CredentialStore for KeyringCredentialStore {
    fn get_credential(&self, service: &str, key: &str) -> RivetResult<Option<SecretString>> {
        let entry =
            keyring::Entry::new(service, key).map_err(|e| RivetError::Storage(e.to_string()))?;
        match entry.get_password() {
            Ok(pass) => Ok(Some(SecretString::from(pass))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(RivetError::Storage(format!("keyring get error: {e}"))),
        }
    }

    fn set_credential(&self, service: &str, key: &str, secret: &str) -> RivetResult<()> {
        let entry =
            keyring::Entry::new(service, key).map_err(|e| RivetError::Storage(e.to_string()))?;
        entry
            .set_password(secret)
            .map_err(|e| RivetError::Storage(format!("keyring set error: {e}")))
    }

    fn delete_credential(&self, service: &str, key: &str) -> RivetResult<bool> {
        let entry =
            keyring::Entry::new(service, key).map_err(|e| RivetError::Storage(e.to_string()))?;
        match entry.delete_credential() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(RivetError::Storage(format!("keyring delete error: {e}"))),
        }
    }
}

#[derive(Default)]
pub struct EnvCredentialStore;

impl CredentialStore for EnvCredentialStore {
    fn get_credential(&self, _service: &str, key: &str) -> RivetResult<Option<SecretString>> {
        let env_key = key.to_uppercase().replace('-', "_");
        if let Ok(val) = std::env::var(&env_key) {
            Ok(Some(SecretString::from(val)))
        } else {
            Ok(None)
        }
    }

    fn set_credential(&self, _service: &str, key: &str, secret: &str) -> RivetResult<()> {
        let env_key = key.to_uppercase().replace('-', "_");
        unsafe { std::env::set_var(env_key, secret) };
        Ok(())
    }

    fn delete_credential(&self, _service: &str, key: &str) -> RivetResult<bool> {
        let env_key = key.to_uppercase().replace('-', "_");
        let exists = std::env::var(&env_key).is_ok();
        if exists {
            unsafe { std::env::remove_var(env_key) };
        }
        Ok(exists)
    }
}

#[derive(Default, Clone)]
pub struct EphemeralCredentialStore {
    store: std::sync::Arc<std::sync::Mutex<HashMap<String, String>>>,
}

impl EphemeralCredentialStore {
    pub fn new() -> Self {
        Self {
            store: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
        }
    }
}

impl CredentialStore for EphemeralCredentialStore {
    fn get_credential(&self, service: &str, key: &str) -> RivetResult<Option<SecretString>> {
        let map = self
            .store
            .lock()
            .map_err(|_| RivetError::Storage("mutex poisoned".into()))?;
        let entry_key = format!("{service}:{key}");
        Ok(map.get(&entry_key).cloned().map(SecretString::from))
    }

    fn set_credential(&self, service: &str, key: &str, secret: &str) -> RivetResult<()> {
        let mut map = self
            .store
            .lock()
            .map_err(|_| RivetError::Storage("mutex poisoned".into()))?;
        let entry_key = format!("{service}:{key}");
        map.insert(entry_key, secret.to_string());
        Ok(())
    }

    fn delete_credential(&self, service: &str, key: &str) -> RivetResult<bool> {
        let mut map = self
            .store
            .lock()
            .map_err(|_| RivetError::Storage("mutex poisoned".into()))?;
        let entry_key = format!("{service}:{key}");
        Ok(map.remove(&entry_key).is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_store_crud_and_masking() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("auth.json");
        let store = AuthStore::with_path(&path);

        assert!(store.all().unwrap().is_empty());
        assert_eq!(store.get("openai").unwrap(), None);

        store
            .set_api_key("openai", "sk-proj-1234567890abcdef")
            .unwrap();
        assert_eq!(
            store.get_api_key("openai").unwrap(),
            Some("sk-proj-1234567890abcdef".into())
        );
        assert_eq!(store.get_active_provider().unwrap(), Some("openai".into()));

        let masked = AuthStore::mask_key("sk-proj-1234567890abcdef");
        assert!(masked.starts_with("sk-proj"));
        assert!(masked.ends_with("cdef"));
        assert!(masked.contains("..."));

        store
            .set_provider_config(
                "custom-vllm",
                "none",
                Some("http://localhost:8000/v1"),
                Some("llama-3.3"),
                vec!["llama-3.3".into(), "deepseek-coder".into()],
            )
            .unwrap();

        assert_eq!(
            store.get_base_url("custom-vllm").unwrap(),
            Some("http://localhost:8000/v1".into())
        );
        assert_eq!(store.get_models("custom-vllm").unwrap().len(), 2);

        store.remove("openai").unwrap();
        assert_eq!(store.get("openai").unwrap(), None);
    }
}
