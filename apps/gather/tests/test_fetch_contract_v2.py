from pathlib import Path
import sys

from fastapi.testclient import TestClient


sys.path.append(str(Path(__file__).resolve().parents[1]))

from main import app  # noqa: E402


client = TestClient(app)


def test_fetch_v2_happy_path():
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "config": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items

    for item in items:
        assert "text" in item
        assert "platform" in item
        assert "sourceId" in item
        assert "sourceType" in item


def test_fetch_v2_validation_error():
    response = client.post(
        "/v2/fetch",
        json={
            "sourceId": "source_123",
            "config": {},
        },
    )

    assert response.status_code == 422
    payload = response.json()

    assert "error" in payload
    assert payload["error"]["code"]
    assert payload["error"]["message"]
    assert payload["error"]["retryable"] is False


def test_fetch_v2_response_formats_text_only():
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "output": {"formats": ["text"]},
            "config": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items
    for item in items:
        assert "text" in item
        assert "markdown" not in item


def test_fetch_v2_response_formats_markdown_only():
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "output": {"formats": ["markdown"]},
            "config": {},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items
    for item in items:
        assert "text" not in item
        assert "markdown" in item


def test_fetch_v2_driver_options_without_legacy_config():
    response = client.post(
        "/v2/fetch",
        json={
            "platform": "contract-test-platform",
            "sourceId": "source_123",
            "driver": "playwright",
            "output": {"formats": ["text"]},
            "driverOptions": {"query": "AI"},
        },
    )

    assert response.status_code == 200
    items = response.json()
    assert isinstance(items, list)
    assert items
    assert "text" in items[0]


def test_fetch_v1_endpoint_removed():
    response = client.post(
        "/fetch",
        json={
            "platform": "contract-test-platform",
            "source_id": "legacy_source_123",
            "config": {},
        },
    )
    assert response.status_code == 404
