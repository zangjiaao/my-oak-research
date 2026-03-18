import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from main import VerifyAuthResponse


def test_verify_auth_prefers_bb_site_script(monkeypatch):
    async def fake_script_verify(_request):
        return VerifyAuthResponse(
            valid=True,
            message="script auth ok",
            details={"verifyMethod": "bb-site-script"},
        )

    async def fake_legacy_verify(_request):  # pragma: no cover - should not be called
        raise AssertionError("legacy verify should not be called when script verify returns result")

    monkeypatch.setattr(main, "_verify_auth_with_bb_site_script", fake_script_verify)
    monkeypatch.setattr(main, "_playwright_verify_auth_legacy", fake_legacy_verify)

    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "x",
            "auth_data": {"cookies": [{"name": "ct0", "value": "demo"}], "origins": []},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "bb-site-script"


def test_verify_auth_requires_script_when_script_verify_not_available(monkeypatch):
    async def fake_script_verify(_request):
        return None

    monkeypatch.setattr(main, "_verify_auth_with_bb_site_script", fake_script_verify)

    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "x",
            "auth_data": {"cookies": [{"name": "ct0", "value": "demo"}], "origins": []},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert payload["details"]["verifyMethod"] == "script-required"


def test_verify_auth_uses_reddit_api_probe_when_script_missing(monkeypatch):
    async def fake_script_verify(_request):
        raise AssertionError("bb-site verify should be skipped for reddit when verifyScriptPath is not set")

    async def fake_reddit_probe(_request):
        return VerifyAuthResponse(
            valid=True,
            message="reddit auth ok",
            details={"verifyMethod": "reddit-api-me", "username": "demo_user"},
        )

    monkeypatch.setattr(main, "_verify_auth_with_bb_site_script", fake_script_verify)
    monkeypatch.setattr(main, "_verify_auth_with_reddit_api_probe", fake_reddit_probe)

    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "reddit",
            "auth_data": {"cookies": [{"name": "reddit_session", "value": "demo"}], "origins": []},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "reddit-api-me"
    assert payload["details"]["username"] == "demo_user"


def test_verify_auth_supports_state_file(monkeypatch, tmp_path):
    state_file = tmp_path / "x_auth.json"
    state_file.write_text(
        '{"cookies":[{"name":"ct0","value":"demo","domain":".x.com","path":"/"}],"origins":[]}',
        encoding="utf-8",
    )

    async def fake_script_verify(request):
        assert request.auth_data is not None
        assert request.auth_data["cookies"][0]["name"] == "ct0"
        return VerifyAuthResponse(
            valid=True,
            message="script auth ok",
            details={"verifyMethod": "bb-site-script"},
        )

    async def fake_legacy_verify(_request):  # pragma: no cover - should not be called
        raise AssertionError("legacy verify should not be called when script verify returns result")

    monkeypatch.setattr(main, "_verify_auth_with_bb_site_script", fake_script_verify)
    monkeypatch.setattr(main, "_playwright_verify_auth_legacy", fake_legacy_verify)

    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "x",
            "stateFile": str(state_file),
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "bb-site-script"


def test_resolve_bb_site_verify_script_prefers_me(monkeypatch, tmp_path):
    base = tmp_path / "bb-sites"
    platform_dir = base / "twitter"
    platform_dir.mkdir(parents=True, exist_ok=True)
    (platform_dir / "user.js").write_text("async function(){return {ok:true}}", encoding="utf-8")
    (platform_dir / "me.ts").write_text("async function(){return {ok:true}}", encoding="utf-8")

    monkeypatch.setattr(main, "_GATHER_VERIFY_SCRIPT_ROOT", tmp_path / "missing")
    monkeypatch.setenv("BB_SITES_DIR", str(base))

    resolved = main._resolve_bb_site_verify_script("x")
    assert resolved is not None
    assert resolved.name == "me.ts"


def test_verify_auth_accepts_verify_script_overrides(monkeypatch):
    async def fake_script_verify(request):
        assert request.verify_script_path == "/tmp/demo/me.ts"
        assert request.verify_args == {"screen_name": "openai"}
        assert request.verify_target_url == "https://x.com"
        return VerifyAuthResponse(
            valid=True,
            message="script auth ok",
            details={"verifyMethod": "bb-site-script"},
        )

    async def fake_legacy_verify(_request):  # pragma: no cover - should not be called
        raise AssertionError("legacy verify should not be called when script verify returns result")

    monkeypatch.setattr(main, "_verify_auth_with_bb_site_script", fake_script_verify)
    monkeypatch.setattr(main, "_playwright_verify_auth_legacy", fake_legacy_verify)

    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "x",
            "auth_data": {"cookies": [{"name": "ct0", "value": "demo"}], "origins": []},
            "verifyScriptPath": "/tmp/demo/me.ts",
            "verifyArgs": {"screen_name": "openai"},
            "verifyTargetUrl": "https://x.com",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "bb-site-script"


def test_verify_auth_uses_agent_browser_for_whatsapp(monkeypatch):
    class FakeResult:
        captures = {"auth_probe": ['{"ok": true}']}

    def fake_execute_agent_browser_script(config):  # noqa: ANN001
        assert "agentBrowser" in config
        return FakeResult()

    async def fake_script_verify(_request):  # pragma: no cover - should not be called
        raise AssertionError("bb-site script verify should not be called for whatsapp when agent-browser succeeds")

    async def fake_legacy_verify(_request):  # pragma: no cover - should not be called
        raise AssertionError("legacy verify should not be called for whatsapp when agent-browser succeeds")

    monkeypatch.setattr(main, "execute_agent_browser_script", fake_execute_agent_browser_script)
    monkeypatch.setattr(main, "_verify_auth_with_bb_site_script", fake_script_verify)
    monkeypatch.setattr(main, "_playwright_verify_auth_legacy", fake_legacy_verify)

    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "whatsapp",
            "auth_data": {"profileName": "demo"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "agent-browser"
