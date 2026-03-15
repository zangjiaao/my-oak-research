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


def test_verify_auth_falls_back_to_legacy_when_script_verify_not_available(monkeypatch):
    async def fake_script_verify(_request):
        return None

    async def fake_legacy_verify(_request):
        return VerifyAuthResponse(
            valid=True,
            message="legacy auth ok",
            details={"verifyMethod": "legacy-client"},
        )

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
    assert payload["details"]["verifyMethod"] == "legacy-client"


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
