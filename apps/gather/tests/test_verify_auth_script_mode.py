import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import app as main
import core.fetch as core_fetch
from schemas import VerifyAuthResponse


def test_verify_auth_uses_x_cookie_probe():
    client = TestClient(main.app)
    response = client.post(
        "/v1/verify-auth",
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
        "/v1/verify-auth",
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


def test_verify_auth_supports_state_file(tmp_path):
    state_file = tmp_path / "x_auth.json"
    state_file.write_text(
        '{"cookies":[{"name":"ct0","value":"demo"},{"name":"auth_token","value":"demo"}],"origins":[]}',
        encoding="utf-8",
    )

    client = TestClient(main.app)
    response = client.post(
        "/v1/verify-auth",
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
        "/v1/verify-auth",
        json={
            "platform": "instagram",
            "auth_data": {"cookies": [], "origins": []},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is False
    assert payload["details"]["verifyMethod"] == "built-in-probe-missing"


def test_verify_auth_uses_playwright_profile_probe_for_whatsapp(monkeypatch):
    async def fake_whatsapp_verify(_request, auth_dir=None):
        return VerifyAuthResponse(
            valid=True,
            message="whatsapp auth ok",
            details={"verifyMethod": "playwright-profile"},
        )

    monkeypatch.setattr(core_fetch, "playwright_verify_auth", fake_whatsapp_verify)

    client = TestClient(main.app)
    response = client.post(
        "/v1/verify-auth",
        json={
            "platform": "whatsapp",
            "auth_data": {"profileName": "demo"},
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["valid"] is True
    assert payload["details"]["verifyMethod"] == "playwright-profile"
