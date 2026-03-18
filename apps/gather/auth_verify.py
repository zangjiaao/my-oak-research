from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

from drivers.agent_browser_runner import AgentBrowserScriptError, execute_agent_browser_script
from schemas import VerifyAuthRequest, VerifyAuthResponse


def _extract_cookie_names(auth_data: dict[str, Any] | None) -> set[str]:
    if not isinstance(auth_data, dict):
        return set()
    cookies = auth_data.get("cookies")
    if not isinstance(cookies, list):
        return set()
    names: set[str] = set()
    for cookie in cookies:
        if not isinstance(cookie, dict):
            continue
        name = cookie.get("name")
        if isinstance(name, str) and name.strip():
            names.add(name.strip())
    return names


def _looks_like_xhs_login_cookie_set(auth_data: dict[str, Any] | None) -> bool:
    cookie_names = _extract_cookie_names(auth_data)
    return "a1" in cookie_names and ("web_session" in cookie_names or "webId" in cookie_names)


async def verify_auth_with_agent_browser_for_whatsapp(
    request: VerifyAuthRequest,
    auth_dir: Path,
) -> VerifyAuthResponse | None:
    if request.platform.lower() != "whatsapp":
        return None

    options: dict[str, Any] = {
        "mode": "self",
        "headless": request.headless,
        "startUrl": "https://web.whatsapp.com",
        "waitAfterNavigationMs": max(0, int(request.verify_post_wait_ms)),
        "timeoutMs": max(1000, int(request.verify_timeout_ms)),
        "capture": [
            {
                "name": "auth_probe",
                "source": "evaluate",
                "script": (
                    "(async()=>{"
                    "const loggedIn=Boolean(document.querySelector('[aria-label=\"Chat list\"]')"
                    "||document.querySelector('[data-testid=\"chat-list\"]')"
                    "||document.querySelector('[contenteditable=\"true\"][data-tab]'));"
                    "const needsQr=Boolean(document.querySelector('canvas[aria-label*=\"QR\"]'));"
                    "if(loggedIn)return JSON.stringify({ok:true});"
                    "if(needsQr)return JSON.stringify({ok:false,error:'QR required'});"
                    "return JSON.stringify({ok:false,error:'Unable to confirm auth status'});"
                    "})()"
                ),
                "captureAs": "auth_probe",
            },
        ],
    }

    if request.state_file:
        options["stateFile"] = request.state_file

    auth_data = request.auth_data or {}
    profile_name = auth_data.get("profileName")
    if isinstance(profile_name, str) and profile_name.strip():
        profile_path = auth_dir / profile_name.strip()
        if profile_path.exists():
            options["profile"] = str(profile_path)

    try:
        script_result = await asyncio.to_thread(
            execute_agent_browser_script,
            {"agentBrowser": options},
        )
    except AgentBrowserScriptError as error:
        print(f"[gather] whatsapp agent-browser verify failed: {error}")
        return VerifyAuthResponse(
            valid=False,
            message=f"WhatsApp auth probe failed: {error}",
            details={"platform": "whatsapp", "verifyMethod": "agent-browser"},
        )
    except Exception as error:  # pragma: no cover
        print(f"[gather] whatsapp agent-browser verify unexpected error: {error}")
        return VerifyAuthResponse(
            valid=False,
            message=f"WhatsApp auth probe failed: {error}",
            details={"platform": "whatsapp", "verifyMethod": "agent-browser"},
        )

    captures = script_result.captures.get("auth_probe") or []
    if not captures:
        return None
    raw = captures[-1]
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    if payload.get("ok") is True:
        return VerifyAuthResponse(
            valid=True,
            message="WhatsApp authentication is valid",
            details={"platform": "whatsapp", "verifyMethod": "agent-browser"},
        )
    return VerifyAuthResponse(
        valid=False,
        message=str(payload.get("error") or "WhatsApp authentication is invalid or expired"),
        details={"platform": "whatsapp", "verifyMethod": "agent-browser"},
    )


async def verify_auth_with_reddit_api_probe(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    if request.platform.lower().strip() != "reddit":
        return None

    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright

    target_url = request.verify_target_url or "https://www.reddit.com"
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=request.headless)
            context = await browser.new_context(storage_state=request.auth_data or {})
            page = await context.new_page()
            try:
                await page.goto(
                    target_url,
                    wait_until="domcontentloaded",
                    timeout=max(1000, int(request.verify_timeout_ms)),
                )
                await page.wait_for_timeout(max(0, int(request.verify_post_wait_ms)))
                result = await page.evaluate(
                    """
                    (async () => {
                      try {
                        const response = await fetch('/api/me.json?raw_json=1', { credentials: 'include' });
                        const text = await response.text();
                        let payload = null;
                        try { payload = JSON.parse(text); } catch (_) {}
                        const username = payload?.name || payload?.data?.name || "";
                        const modhash = payload?.modhash || payload?.data?.modhash || "";
                        if (response.ok && username) {
                          return { ok: true, status: response.status, username, modhash };
                        }
                        return {
                          ok: false,
                          status: response.status,
                          username,
                          modhash,
                          error: response.status === 401 || response.status === 403
                            ? 'not_logged_in'
                            : 'cannot_confirm_logged_in_state',
                        };
                      } catch (error) {
                        return { ok: false, status: 0, error: String(error || 'reddit auth probe failed') };
                      }
                    })()
                    """
                )
            finally:
                await context.close()
                await browser.close()
    except PlaywrightTimeoutError as error:
        return VerifyAuthResponse(
            valid=False,
            message=f"Reddit auth probe timed out: {error}",
            details={"platform": "reddit", "verifyMethod": "reddit-api-me"},
        )
    except Exception as error:
        return VerifyAuthResponse(
            valid=False,
            message=f"Reddit auth probe failed: {error}",
            details={"platform": "reddit", "verifyMethod": "reddit-api-me"},
        )

    if not isinstance(result, dict):
        return VerifyAuthResponse(
            valid=False,
            message="Cannot confirm Reddit auth status",
            details={"platform": "reddit", "verifyMethod": "reddit-api-me"},
        )

    if result.get("ok") is True and isinstance(result.get("username"), str) and result.get("username").strip():
        return VerifyAuthResponse(
            valid=True,
            message="reddit authentication is valid",
            details={
                "platform": "reddit",
                "verifyMethod": "reddit-api-me",
                "username": result.get("username"),
                "status": result.get("status"),
                "hasModhash": bool(result.get("modhash")),
            },
        )

    message = "reddit authentication is invalid or expired"
    if result.get("error") == "cannot_confirm_logged_in_state":
        message = "Cannot confirm Reddit auth status"
    return VerifyAuthResponse(
        valid=False,
        message=message,
        details={
            "platform": "reddit",
            "verifyMethod": "reddit-api-me",
            "status": result.get("status"),
            "error": result.get("error"),
        },
    )


async def verify_auth_with_xhs_api_probe(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    if request.platform.lower().strip() not in {"xhs", "xiaohongshu"}:
        return None

    from playwright.async_api import TimeoutError as PlaywrightTimeoutError
    from playwright.async_api import async_playwright

    target_url = request.verify_target_url or "https://www.xiaohongshu.com/explore"
    try:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=request.headless)
            context = await browser.new_context(storage_state=request.auth_data or {})
            page = await context.new_page()
            try:
                await page.goto(
                    target_url,
                    wait_until="domcontentloaded",
                    timeout=max(1000, int(request.verify_timeout_ms)),
                )
                await page.wait_for_timeout(max(0, int(request.verify_post_wait_ms)))
                result = await page.evaluate(
                    """
                    (async () => {
                      try {
                        const candidates = [
                          "/api/sns/web/v1/user/me",
                          "https://www.xiaohongshu.com/api/sns/web/v1/user/me",
                        ];
                        let lastStatus = 0;
                        let profileLink = "";
                        try {
                          const profileAnchor = document.querySelector('a[href*="/user/profile/"]');
                          profileLink = profileAnchor?.getAttribute("href") || "";
                        } catch (_) {}
                        for (const endpoint of candidates) {
                          const response = await fetch(endpoint, { credentials: "include" });
                          lastStatus = response.status;
                          const text = await response.text();
                          let payload = null;
                          try { payload = JSON.parse(text); } catch (_) {}
                          const user = payload?.data || {};
                          const userId = user?.user_id || "";
                          if (response.ok && payload?.success === true && userId) {
                            return {
                              ok: true,
                              status: response.status,
                              userId,
                              nickname: user?.nickname || "",
                              redId: user?.red_id || "",
                              profileLink,
                            };
                          }
                        }
                        return { ok: false, status: lastStatus, error: "not_logged_in", profileLink };
                      } catch (error) {
                        return { ok: false, status: 0, error: String(error || "xhs auth probe failed"), profileLink: "" };
                      }
                    })()
                    """
                )
            finally:
                await context.close()
                await browser.close()
    except PlaywrightTimeoutError as error:
        return VerifyAuthResponse(
            valid=False,
            message=f"Xiaohongshu auth probe timed out: {error}",
            details={"platform": "xhs", "verifyMethod": "xhs-api-me"},
        )
    except Exception as error:
        return VerifyAuthResponse(
            valid=False,
            message=f"Xiaohongshu auth probe failed: {error}",
            details={"platform": "xhs", "verifyMethod": "xhs-api-me"},
        )

    if not isinstance(result, dict):
        return VerifyAuthResponse(
            valid=False,
            message="Cannot confirm Xiaohongshu auth status",
            details={"platform": "xhs", "verifyMethod": "xhs-api-me"},
        )

    user_id = result.get("userId")
    if result.get("ok") is True and isinstance(user_id, str) and user_id.strip():
        return VerifyAuthResponse(
            valid=True,
            message="xiaohongshu authentication is valid",
            details={
                "platform": "xhs",
                "verifyMethod": "xhs-api-me",
                "userId": user_id,
                "nickname": result.get("nickname"),
                "redId": result.get("redId"),
                "status": result.get("status"),
            },
        )

    profile_link = result.get("profileLink")
    if isinstance(profile_link, str) and "/user/profile/" in profile_link:
        return VerifyAuthResponse(
            valid=True,
            message="xiaohongshu authentication looks valid (dom fallback)",
            details={
                "platform": "xhs",
                "verifyMethod": "xhs-dom-fallback",
                "profileLink": profile_link,
                "status": result.get("status"),
                "error": result.get("error"),
            },
        )

    if _looks_like_xhs_login_cookie_set(request.auth_data):
        return VerifyAuthResponse(
            valid=True,
            message="xiaohongshu authentication looks valid (cookie fallback)",
            details={
                "platform": "xhs",
                "verifyMethod": "xhs-cookie-fallback",
                "status": result.get("status"),
                "error": result.get("error"),
                "cookieNames": sorted(_extract_cookie_names(request.auth_data)),
            },
        )

    return VerifyAuthResponse(
        valid=False,
        message="xiaohongshu authentication is invalid or expired",
        details={
            "platform": "xhs",
            "verifyMethod": "xhs-api-me",
            "status": result.get("status"),
            "error": result.get("error"),
        },
    )


def resolve_verify_auth_data(request: VerifyAuthRequest) -> tuple[dict[str, Any] | None, VerifyAuthResponse | None]:
    if isinstance(request.auth_data, dict):
        return request.auth_data, None

    if request.state_file:
        path = Path(request.state_file).expanduser()
        if not path.exists():
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile does not exist: {request.state_file}",
                details={"error": "invalid_state_file"},
            )
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile is not valid JSON: {request.state_file}",
                details={"error": str(error)},
            )
        if not isinstance(payload, dict):
            return None, VerifyAuthResponse(
                valid=False,
                message=f"stateFile must contain a JSON object: {request.state_file}",
                details={"error": "invalid_state_payload"},
            )
        return payload, None

    if request.platform.lower() == "whatsapp":
        return {}, None

    return None, VerifyAuthResponse(
        valid=False,
        message="auth_data or stateFile is required",
        details={"error": "missing_auth_data"},
    )


def verify_auth_with_x_cookie_probe(request: VerifyAuthRequest) -> VerifyAuthResponse | None:
    if request.platform.lower().strip() not in {"x", "twitter"}:
        return None
    auth_data = request.auth_data if isinstance(request.auth_data, dict) else {}
    cookies = auth_data.get("cookies")
    if not isinstance(cookies, list):
        return VerifyAuthResponse(
            valid=False,
            message="x authentication cookies are missing",
            details={"platform": "x", "verifyMethod": "x-cookie-probe"},
        )

    cookie_names = _extract_cookie_names(auth_data)
    is_valid = "ct0" in cookie_names and "auth_token" in cookie_names
    return VerifyAuthResponse(
        valid=is_valid,
        message="x authentication is valid" if is_valid else "x authentication is invalid or expired",
        details={
            "platform": "x",
            "verifyMethod": "x-cookie-probe",
            "cookieNames": sorted(name for name in cookie_names if name),
        },
    )


async def playwright_verify_auth(request: VerifyAuthRequest, auth_dir: Path) -> VerifyAuthResponse:
    auth_data, error_response = resolve_verify_auth_data(request)
    if error_response is not None:
        return error_response
    normalized_request = request.model_copy(update={"auth_data": auth_data or {}})

    whatsapp_result = await verify_auth_with_agent_browser_for_whatsapp(normalized_request, auth_dir=auth_dir)
    if whatsapp_result is not None:
        return whatsapp_result

    reddit_result = await verify_auth_with_reddit_api_probe(normalized_request)
    if reddit_result is not None:
        return reddit_result

    xhs_result = await verify_auth_with_xhs_api_probe(normalized_request)
    if xhs_result is not None:
        return xhs_result

    x_result = verify_auth_with_x_cookie_probe(normalized_request)
    if x_result is not None:
        return x_result

    return VerifyAuthResponse(
        valid=False,
        message="No built-in verify probe for this platform",
        details={"verifyMethod": "built-in-probe-missing"},
    )


async def agent_browser_verify_auth(_request: VerifyAuthRequest) -> VerifyAuthResponse:
    return VerifyAuthResponse(
        valid=True,
        message="agent-browser authentication is configured through fetch config (profile/session/state).",
    )
