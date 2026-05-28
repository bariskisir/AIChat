//! Browser-based Claude.ai credential extraction via Chrome DevTools Protocol.
//! Also fetches available models via CDP JavaScript execution (bypasses Cloudflare).

use crate::domain::{AvailableModel, ClaudeCredential};
use crate::infra::claude;
use anyhow::{Context, Result, anyhow};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::time::Duration;
use tokio_tungstenite::connect_async;

pub struct LoginResult {
    pub credential: ClaudeCredential,
    pub models: Vec<AvailableModel>,
}

/// Finds an installed Chromium browser that can expose the DevTools Protocol.
fn find_chrome() -> Option<PathBuf> {
    let candidates = [
        // Standard Chrome locations
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"${LOCALAPPDATA}\Google\Chrome\Application\chrome.exe",
        // Edge (Chromium-based)
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        // Brave
        r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        r"${LOCALAPPDATA}\BraveSoftware\Brave-Browser\Application\brave.exe",
    ];

    for raw in &candidates {
        let expanded = raw.replace(
            "${LOCALAPPDATA}",
            &std::env::var("LOCALAPPDATA").unwrap_or_default(),
        );
        let p = PathBuf::from(&expanded);
        if p.exists() {
            return Some(p);
        }
    }

    // Try PATH lookup as last resort
    if let Ok(output) = std::process::Command::new("where")
        .arg("chrome")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output()
    {
        let path = String::from_utf8_lossy(&output.stdout)
            .lines()
            .next()
            .map(|l| l.trim().to_owned())
            .unwrap_or_default();
        if !path.is_empty() && PathBuf::from(&path).exists() {
            return Some(PathBuf::from(path));
        }
    }

    None
}

/// Creates an isolated temporary browser profile directory for login.
fn create_temp_dir() -> Result<PathBuf> {
    let tmp = std::env::temp_dir().join(format!("claude_chat_{:016x}", rand::random::<u64>()));
    std::fs::create_dir_all(&tmp).context("Could not create temp profile dir")?;
    Ok(tmp)
}

/// Reserves a local port for Chrome remote debugging.
fn find_free_port() -> Result<u16> {
    let listener =
        std::net::TcpListener::bind("127.0.0.1:0").context("Could not bind to find free port")?;
    Ok(listener.local_addr()?.port())
}

pub struct BrowserExtractor {
    chrome_path: PathBuf,
    temp_dir: PathBuf,
    cdp_port: u16,
    chrome_process: Option<Child>,
}

impl BrowserExtractor {
    /// Creates a browser extractor with a temporary profile and CDP port.
    pub fn new() -> Result<Self> {
        let chrome_path = find_chrome()
            .ok_or_else(|| anyhow!("Chrome not found. Install Google Chrome first."))?;
        let temp_dir = create_temp_dir()?;
        let cdp_port = find_free_port()?;
        Ok(Self {
            chrome_path,
            temp_dir,
            cdp_port,
            chrome_process: None,
        })
    }

    /// Launches Chrome or another Chromium browser on the Claude login page.
    pub fn launch(&mut self) -> Result<()> {
        let child = Command::new(&self.chrome_path)
            .arg(format!("--remote-debugging-port={}", self.cdp_port))
            .arg("--remote-allow-origins=*")
            .arg(format!("--user-data-dir={}", self.temp_dir.display()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check")
            .arg("https://claude.ai/new")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .context("Could not launch Chrome. Try closing all Chrome windows first.")?;
        self.chrome_process = Some(child);
        Ok(())
    }

    /// Opens a temporary browser and fetches bootstrap JSON using stored cookies.
    pub async fn fetch_bootstrap_with_cookies(
        org_id: &str,
        cookies: &HashMap<String, String>,
    ) -> Result<String> {
        let mut extractor = Self::new()?;
        extractor.launch()?;
        extractor.wait_for_cdp().await?;
        extractor.fetch_bootstrap_via_cdp(org_id, cookies).await
    }

    /// Waits for login, extracts Claude credentials, account metadata, and models.
    pub async fn extract(self) -> Result<LoginResult> {
        self.wait_for_cdp().await?;
        let ws_url = self.get_ws_url().await?;
        let cookies = self.wait_for_login(&ws_url).await?;
        let session_key = cookies
            .get("sessionKey")
            .cloned()
            .ok_or_else(|| anyhow!("sessionKey not found. Make sure you logged into claude.ai."))?;

        let org_id = self.fetch_org_id(&session_key).await?;

        let bootstrap = match fetch_bootstrap_direct(&org_id, &session_key, &cookies).await {
            Ok(json) => Some(json),
            Err(error) => {
                log::warn!("Direct login bootstrap fetch failed, trying browser fetch: {error}");
                self.fetch_bootstrap_via_cdp(&org_id, &cookies).await.ok()
            }
        };
        let user_info = if let Some(json) = bootstrap.as_deref() {
            let parsed = claude::parse_account_info(json);
            if !parsed.0.is_empty() || !parsed.1.is_empty() {
                parsed
            } else {
                self.fetch_user_info_via_cdp(&org_id, &cookies)
                    .await
                    .unwrap_or_default()
            }
        } else {
            self.fetch_user_info_via_cdp(&org_id, &cookies)
                .await
                .unwrap_or_default()
        };
        let model_result = if let Some(json) = bootstrap.as_deref() {
            match claude::parse_model_response_for_plan(json, Some(&user_info.1)) {
                Ok(models) => Ok(models),
                Err(_) => {
                    self.fetch_models_via_cdp(&org_id, &cookies, &user_info.1)
                        .await
                }
            }
        } else {
            self.fetch_models_via_cdp(&org_id, &cookies, &user_info.1)
                .await
        };
        let models = model_result?;

        Ok(LoginResult {
            credential: ClaudeCredential {
                org_id,
                session_key,
                cookies,
                email: user_info.0,
                plan: user_info.1,
                error: String::new(),
            },
            models,
        })
    }

    /// Waits until Chrome's DevTools HTTP endpoint is reachable.
    async fn wait_for_cdp(&self) -> Result<()> {
        let url = format!("http://127.0.0.1:{}/json/version", self.cdp_port);
        for i in 0..30 {
            if let Ok(resp) = reqwest::get(&url).await {
                if resp.status().is_success() {
                    log::info!("CDP ready on port {} (attempt {})", self.cdp_port, i + 1);
                    return Ok(());
                }
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        Err(anyhow!("Chrome CDP did not become ready after 30 seconds"))
    }

    /// Reads the WebSocket debugger URL for the active Claude page.
    async fn get_ws_url(&self) -> Result<String> {
        let url = format!("http://127.0.0.1:{}/json", self.cdp_port);
        let resp = reqwest::get(&url)
            .await
            .context("Could not fetch CDP page list")?;
        let targets: Vec<Value> = resp.json().await.context("Could not parse CDP page list")?;
        let target = targets
            .iter()
            .find(|target| {
                target["type"].as_str() == Some("page")
                    && target["url"]
                        .as_str()
                        .is_some_and(|url| url.starts_with("https://claude.ai"))
                    && target["webSocketDebuggerUrl"].as_str().is_some()
            })
            .or_else(|| {
                targets.iter().find(|target| {
                    target["type"].as_str() == Some("page")
                        && target["webSocketDebuggerUrl"].as_str().is_some()
                })
            })
            .ok_or_else(|| anyhow!("No page found in Chrome. Open claude.ai in the window."))?;
        let ws_url = target["webSocketDebuggerUrl"]
            .as_str()
            .ok_or_else(|| anyhow!("Chrome page has no debugger URL."))?;
        Ok(ws_url.to_owned())
    }

    /// Polls Chrome cookies until Claude login provides a session key.
    async fn wait_for_login(&self, ws_url: &str) -> Result<HashMap<String, String>> {
        let (ws_stream, _) = connect_async(ws_url)
            .await
            .context("Could not connect to Chrome CDP WebSocket")?;
        let (mut write, mut read) = ws_stream.split();

        let mut msg_id = 1u64;

        for attempt in 0..120 {
            let cmd = serde_json::json!({
                "id": msg_id,
                "method": "Network.getAllCookies"
            });
            write
                .send(tokio_tungstenite::tungstenite::Message::Text(
                    serde_json::to_string(&cmd).unwrap().into(),
                ))
                .await?;

            msg_id += 1;

            let timeout = tokio::time::sleep(Duration::from_secs(2));
            tokio::pin!(timeout);

            loop {
                tokio::select! {
                    msg = read.next() => {
                        match msg {
                            Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                                if let Ok(val) = serde_json::from_str::<Value>(&text) {
                                    if let Some(cookies) = val["result"]["cookies"].as_array() {
                                        let map: HashMap<String, String> = cookies.iter()
                                            .filter_map(|c| {
                                                let name = c["name"].as_str()?;
                                                let value = c["value"].as_str()?;
                                                Some((name.to_owned(), value.to_owned()))
                                            })
                                            .collect();
                                        if map.contains_key("sessionKey") {
                                            return Ok(map);
                                        }
                                    }
                                }
                            }
                            Some(Err(e)) => log::warn!("CDP WS error: {e}"),
                            None => break,
                            _ => {}
                        }
                    }
                    _ = &mut timeout => break,
                }
            }

            if attempt == 0 {
                log::info!("Waiting for login on claude.ai... (sessionKey not found yet)");
            }
            if attempt % 10 == 9 {
                log::info!("Still waiting for Claude login... ({}/120)", attempt + 1);
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }

        Err(anyhow!(
            "Login timeout. Make sure you logged into claude.ai in the opened Chrome window."
        ))
    }

    /// Fetches account email and plan details from the logged-in Claude page.
    async fn fetch_user_info_via_cdp(
        &self,
        org_id: &str,
        cookies: &HashMap<String, String>,
    ) -> Result<(String, String)> {
        let ws_url = self.get_ws_url().await?;
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .context("Could not connect to CDP for user info")?;
        let (mut write, mut read) = ws_stream.split();

        let cookie_js = cookie_assignment_script(cookies);

        // Try to get user info from organizations endpoint (includes plan) and extract email from page
        let expression = format!(
            r#"(async () => {{
                {};
                let email = '';
                let plan = '';
                try {{
                    const r = await fetch('/api/organizations/{org_id}', {{ credentials: 'include' }});
                    if (r.ok) {{
                        const data = await r.json();
                        email = data.owner_email || data.email || '';
                        plan = data.plan || data.subscription?.tier || data.billing_plan || '';
                    }}
                }} catch(e) {{}}
                try {{
                    const el = document.querySelector('[data-testid="user-email"], .email-display, [class*="email"]');
                    if (el) email = el.textContent?.trim() || email;
                }} catch(e) {{}}
                return JSON.stringify({{email, plan}});
            }})()"#,
            cookie_js,
            org_id = org_id
        );

        let cmd = serde_json::json!({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "awaitPromise": true,
                "returnByValue": true
            }
        });

        write
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::to_string(&cmd).unwrap().into(),
            ))
            .await?;

        let timeout = tokio::time::sleep(Duration::from_secs(10));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                msg = read.next() => {
                    match msg {
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                                if val["id"].as_u64() == Some(1) {
                                    if let Some(result) = val["result"]["result"]["value"].as_str() {
                                        let parsed: Value = serde_json::from_str(result).unwrap_or_default();
                                        let email = parsed["email"].as_str().unwrap_or("").to_owned();
                                        let plan = parsed["plan"].as_str().unwrap_or("").to_owned();
                                        return Ok((email, plan));
                                    }
                                    return Ok((String::new(), String::new()));
                                }
                            }
                        }
                        Some(Err(e)) => log::warn!("CDP WS error during user info fetch: {e}"),
                        None => break,
                        _ => {}
                    }
                }
                _ = &mut timeout => break,
            }
        }
        Ok((String::new(), String::new()))
    }

    /// Fetches and parses the model catalog through the logged-in browser context.
    async fn fetch_models_via_cdp(
        &self,
        org_id: &str,
        cookies: &HashMap<String, String>,
        plan: &str,
    ) -> Result<Vec<AvailableModel>> {
        let result = self.fetch_bootstrap_via_cdp(org_id, cookies).await?;
        claude::parse_model_response_for_plan(&result, Some(plan))
    }

    /// Fetches Claude bootstrap JSON inside Chrome so browser-only checks pass.
    async fn fetch_bootstrap_via_cdp(
        &self,
        org_id: &str,
        cookies: &HashMap<String, String>,
    ) -> Result<String> {
        let ws_url = self.get_ws_url().await?;
        let (ws_stream, _) = connect_async(&ws_url)
            .await
            .context("Could not connect to CDP for model fetch")?;
        let (mut write, mut read) = ws_stream.split();

        let cookie_js = cookie_assignment_script(cookies);

        let expression = format!(
            r#"(async () => {{
                {};
                if (location.origin !== 'https://claude.ai') {{
                    location.href = 'https://claude.ai/new';
                    await new Promise((resolve) => setTimeout(resolve, 2500));
                }}
                const url = 'https://claude.ai/edge-api/bootstrap/{org_id}/app_start?statsig_hashing_algorithm=djb2&growthbook_format=sdk&include_system_prompts=false';
                try {{
                    const r = await fetch(url, {{
                        credentials: 'include',
                        headers: {{
                            'accept': 'application/json',
                            'anthropic-client-platform': 'web_claude_ai',
                            'anthropic-client-version': '1.0.0',
                        }},
                    }});
                    const text = await r.text();
                    return JSON.stringify({{
                        ok: r.ok,
                        status: r.status,
                        url,
                        body: text,
                        href: location.href,
                    }});
                }} catch(e) {{
                    return JSON.stringify({{
                        ok: false,
                        status: 0,
                        url,
                        body: String(e),
                        href: location.href,
                    }});
                }}
            }})()"#,
            cookie_js,
            org_id = org_id
        );

        let cmd = serde_json::json!({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "awaitPromise": true,
                "returnByValue": true
            }
        });

        write
            .send(tokio_tungstenite::tungstenite::Message::Text(
                serde_json::to_string(&cmd).unwrap().into(),
            ))
            .await?;

        // Give Chrome up to 15 seconds to fetch
        let timeout = tokio::time::sleep(Duration::from_secs(15));
        tokio::pin!(timeout);

        loop {
            tokio::select! {
                msg = read.next() => {
                    match msg {
                        Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                            if let Ok(val) = serde_json::from_str::<Value>(&text) {
                                if val["id"].as_u64() == Some(1) {
                                    if let Some(result) = val["result"]["result"]["value"].as_str() {
                                        return parse_bootstrap_eval_result(result);
                                    }
                                    return Err(anyhow!("No model data returned from page. CDP result: {}", val));
                                }
                            }
                        }
                        Some(Err(e)) => log::warn!("CDP WS error during model fetch: {e}"),
                        None => return Err(anyhow!("CDP connection closed during model fetch")),
                        _ => {}
                    }
                }
                _ = &mut timeout => {
                    return Err(anyhow!("Timed out waiting for model fetch from page"));
                }
            }
        }
    }

    /// Looks up the first Claude organization for the active session key.
    async fn fetch_org_id(&self, session_key: &str) -> Result<String> {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://claude.ai/api/organizations")
            .header("Cookie", format!("sessionKey={session_key}"))
            .send()
            .await
            .context("Could not fetch organizations from claude.ai")?;

        if !resp.status().is_success() {
            return Err(anyhow!(
                "Failed to get organizations: HTTP {}",
                resp.status()
            ));
        }

        let data: Vec<Value> = resp
            .json()
            .await
            .context("Could not parse organizations response")?;

        let org_id = data
            .first()
            .and_then(|o| o["uuid"].as_str().or_else(|| o["id"].as_str()))
            .ok_or_else(|| anyhow!("No organizations found on claude.ai"))?
            .to_owned();

        Ok(org_id)
    }
}

/// Fetches Claude bootstrap JSON directly with the cookies captured during login.
async fn fetch_bootstrap_direct(
    org_id: &str,
    session_key: &str,
    cookies: &HashMap<String, String>,
) -> Result<String> {
    let credential = ClaudeCredential {
        org_id: org_id.to_owned(),
        session_key: session_key.to_owned(),
        cookies: cookies.clone(),
        email: String::new(),
        plan: String::new(),
        error: String::new(),
    };
    let ctx = claude::ClaudeContext::from_credential(&credential);
    claude::fetch_bootstrap_json(&ctx).await
}

/// Builds JavaScript that installs stored cookies into the Claude page context.
fn cookie_assignment_script(cookies: &HashMap<String, String>) -> String {
    cookies
        .iter()
        .map(|(key, value)| {
            let cookie = format!("{key}={value}; path=/; domain=.claude.ai");
            format!("document.cookie = {};", js_string(&cookie))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Escapes a Rust string as a JavaScript string literal.
fn js_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_owned())
}

/// Extracts bootstrap JSON or a useful HTTP diagnostic from a CDP evaluation result.
fn parse_bootstrap_eval_result(result: &str) -> Result<String> {
    let value: Value = serde_json::from_str(result)
        .with_context(|| format!("Could not parse bootstrap fetch result: {result}"))?;
    if value["ok"].as_bool() == Some(true) {
        let body = value["body"]
            .as_str()
            .ok_or_else(|| anyhow!("Claude bootstrap fetch returned no body."))?;
        return Ok(body.to_owned());
    }
    let status = value["status"].as_u64().unwrap_or_default();
    let href = value["href"].as_str().unwrap_or("");
    let body = value["body"].as_str().unwrap_or("");
    Err(anyhow!(
        "Claude bootstrap fetch failed in browser with status {status} at {href}. {}",
        body.chars().take(240).collect::<String>()
    ))
}

impl Drop for BrowserExtractor {
    /// Stops the temporary browser process and removes its profile directory.
    fn drop(&mut self) {
        if let Some(mut child) = self.chrome_process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.temp_dir);
    }
}
