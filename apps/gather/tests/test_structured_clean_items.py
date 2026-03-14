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


def test_agent_browser_capture_parses_jsonl_records():
    request = FetchRequest(platform="telegram", config={}, source_id="source-1")
    result = _script_result(
        {
            "messages_text": [
                '{"recordId":"message-10","recordType":"telegram","text":"alpha one","url":"https://t.me/c/1/10","time":"2026-03-14T10:00:00Z"}\n'
                '{"recordId":"message-11","recordType":"telegram","text":"beta two"}'
            ]
        }
    )

    items = _agent_browser_results_to_clean_items(request, result)
    assert len(items) == 2
    assert items[0].recordId == "message-10"
    assert items[0].recordType == "telegram"
    assert items[0].url == "https://t.me/c/1/10"
    assert items[0].time is not None
    assert items[1].recordId == "message-11"


def test_agent_browser_capture_parses_tagged_records_with_custom_schema():
    request = FetchRequest(
        platform="telegram",
        source_id="source-1",
        config={
            "recordSchema": {
                "format": "tagged",
                "recordSeparator": "\n",
                "pairSeparator": "｜",
                "fieldMap": {
                    "id": "MSGID",
                    "text": "MSG",
                    "url": "LINK",
                    "time": "DATE",
                    "type": "TYPE",
                },
            }
        },
    )
    result = _script_result(
        {
            "messages_text": [
                "MSGID：message-21｜MSG：hello alpha｜TYPE：telegram｜LINK：https://t.me/c/1/21｜DATE：2026-03-14T10:00:00+00:00\n"
                "MSGID：message-22｜MSG：hello beta｜TYPE：telegram"
            ]
        }
    )

    items = _agent_browser_results_to_clean_items(request, result)
    assert len(items) == 2
    assert items[0].recordId == "message-21"
    assert items[0].recordType == "telegram"
    assert "hello alpha" in (items[0].text or "")
    assert items[1].recordId == "message-22"
