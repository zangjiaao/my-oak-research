import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import main
from main import VerifyAuthResponse


def test_verify_auth_uses_x_cookie_probe():
    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "x",
            "auth_data": {
                "cookies": [
                    {"name": "ct0", "value": "demo"},
                    {"name": "auth_token", "value": "demo"},
                ],
                "origins": [],
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "x-cookie-probe"


def test_verify_auth_rejects_x_when_required_cookie_missing():
    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "x",
            "auth_data": {
                "cookies": [{"name": "ct0", "value": "demo"}],
                "origins": [],
            },
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert payload["details"]["verifyMethod"] == "x-cookie-probe"


def test_verify_auth_uses_reddit_api_probe(monkeypatch):
    async def fake_reddit_probe(_request):
        return VerifyAuthResponse(
            valid=True,
            message="reddit auth ok",
            details={"verifyMethod": "reddit-api-me", "username": "demo_user"},
        )

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


def test_verify_auth_uses_xhs_api_probe(monkeypatch):
    async def fake_xhs_probe(_request):
        return VerifyAuthResponse(
            valid=True,
            message="xhs auth ok",
            details={"verifyMethod": "xhs-api-me", "userId": "66f26918000000000101adf0"},
        )

    monkeypatch.setattr(main, "_verify_auth_with_xhs_api_probe", fake_xhs_probe)

    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "xhs",
            "auth_data": {"cookies": [{"name": "webId", "value": "demo"}], "origins": []},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "xhs-api-me"
    assert payload["details"]["userId"] == "66f26918000000000101adf0"


def test_verify_auth_supports_state_file(tmp_path):
    state_file = tmp_path / "x_auth.json"
    state_file.write_text(
        '{"cookies":[{"name":"ct0","value":"demo"},{"name":"auth_token","value":"demo"}],"origins":[]}',
        encoding="utf-8",
    )

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
    assert payload["details"]["verifyMethod"] == "x-cookie-probe"


def test_verify_auth_returns_missing_probe_for_unknown_platform():
    client = TestClient(main.app)
    response = client.post(
        "/verify-auth",
        json={
            "platform": "instagram",
            "auth_data": {"cookies": [], "origins": []},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert payload["details"]["verifyMethod"] == "built-in-probe-missing"


def test_verify_auth_uses_agent_browser_for_whatsapp(monkeypatch):
    async def fake_whatsapp_verify(_request):
        return VerifyAuthResponse(
            valid=True,
            message="whatsapp auth ok",
            details={"verifyMethod": "agent-browser"},
        )

    monkeypatch.setattr(main, "_verify_auth_with_agent_browser_for_whatsapp", fake_whatsapp_verify)

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
