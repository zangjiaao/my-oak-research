import sys
from pathlib import Path
from types import SimpleNamespace

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from main import FetchRequest, _agent_browser_results_to_clean_items  # noqa: E402


def _script_result(captures):
    return SimpleNamespace(
        captures=captures,
        instance_id="ab-test",
        tab_id="tab-test",
        instance_active=True,
        step_results=[],
    )


def test_agent_browser_capture_splits_message_records():
    request = FetchRequest(platform="telegram", config={}, source_id="source-1")
    result = _script_result(
        {
            "messages_text": [
                'message-1: hello world\\nmessage-2: alpha signal detected'
            ]
        }
    )

    items = _agent_browser_results_to_clean_items(request, result)
    assert len(items) == 2
    assert items[0].recordId == "message-1"
    assert items[0].recordType == "message"
    assert items[1].recordId == "message-2"
    assert "alpha signal detected" in (items[1].text or "")


def test_agent_browser_capture_keeps_single_item_when_unstructured():
    request = FetchRequest(platform="x", config={}, source_id="source-1")
    result = _script_result({"snapshot": ["plain capture text"]})

    items = _agent_browser_results_to_clean_items(request, result)
    assert len(items) == 1
    assert items[0].recordType == "capture"
