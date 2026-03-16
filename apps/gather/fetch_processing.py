import json
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from schemas import CleanItem, FetchRequest, KeywordFilterConfigError


def _truncate_text(value: str, max_length: int = 12000) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[:max_length]}..."


def _normalize_capture_text(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith('"""') and normalized.endswith('"""'):
        normalized = normalized[3:-3]
    for _ in range(2):
        if normalized.startswith('"') and normalized.endswith('"'):
            try:
                decoded = json.loads(normalized)
            except json.JSONDecodeError:
                break
            if isinstance(decoded, str):
                normalized = decoded.strip()
                continue
        break
    normalized = normalized.replace("\\r\\n", "\n").replace("\\n", "\n")
    return normalized.strip()


def _resolve_record_schema(config: Dict[str, Any]) -> dict[str, Any]:
    default_schema = {
        "format": "auto",
        "record_separator": "\n",
        "pair_separator": "｜",
        "field_map": {
            "id": "MSGID",
            "text": "MSG",
            "url": "LINK",
            "time": "DATE",
            "meta": "META",
            "author": "AUTH",
            "type": "TYPE",
        },
    }
    raw = config.get("recordSchema")
    if raw is None and isinstance(config.get("outputFormat"), str):
        raw = {"format": config.get("outputFormat")}
    if raw is None and isinstance(config.get("output"), dict):
        output = config["output"]
        if isinstance(output.get("record"), dict):
            raw = output["record"]
    if raw is None and isinstance(config.get("agentBrowser"), dict):
        raw = config["agentBrowser"].get("recordSchema")
    if not isinstance(raw, dict):
        return default_schema

    schema = dict(default_schema)
    schema["format"] = str(raw.get("format", schema["format"])).lower()
    if isinstance(raw.get("recordSeparator"), str) and raw["recordSeparator"]:
        schema["record_separator"] = raw["recordSeparator"]
    if isinstance(raw.get("pairSeparator"), str) and raw["pairSeparator"]:
        schema["pair_separator"] = raw["pairSeparator"]
    field_map = raw.get("fieldMap")
    if isinstance(field_map, dict):
        normalized_map: dict[str, str] = {}
        for key, value in field_map.items():
            if isinstance(key, str) and isinstance(value, str) and key and value:
                normalized_map[key.lower()] = value.upper()
        if normalized_map:
            schema["field_map"] = {**schema["field_map"], **normalized_map}
    return schema


def _extract_jsonl_records(text: str) -> list[dict[str, Any]]:
    def parse_object_line(raw_line: str) -> Optional[dict[str, Any]]:
        try:
            payload = json.loads(raw_line)
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict):
            return None
        body = payload.get("text", payload.get("content", ""))
        if not isinstance(body, str) or not body.strip():
            return None
        record_id = payload.get("recordId", payload.get("id"))
        record_type = payload.get("recordType", payload.get("type", "message"))
        return {
            "record_id": str(record_id).strip() if record_id else None,
            "record_type": str(record_type).strip() if record_type else "message",
            "body": body.strip(),
            "url": str(payload["url"]).strip() if isinstance(payload.get("url"), str) else None,
            "time": str(payload["time"]).strip() if isinstance(payload.get("time"), str) else None,
            "meta": str(payload["meta"]).strip() if isinstance(payload.get("meta"), str) else None,
            "author": str(payload["author"]).strip() if isinstance(payload.get("author"), str) else None,
        }

    def expand_line_candidates(raw_line: str) -> list[str]:
        candidates: list[str] = []
        queue = [raw_line.strip()]
        seen: set[str] = set()
        while queue:
            current = queue.pop(0).strip()
            if not current or current in seen:
                continue
            seen.add(current)
            candidates.append(current)
            if current == '""':
                continue
            if current.startswith('"') and current.endswith('"'):
                try:
                    decoded = json.loads(current)
                except json.JSONDecodeError:
                    decoded = current[1:-1]
                if isinstance(decoded, str):
                    queue.extend(part.strip() for part in decoded.splitlines() if part.strip())
            if "\\n" in current:
                queue.extend(part.strip() for part in current.split("\\n") if part.strip())
            if "\n" in current:
                queue.extend(part.strip() for part in current.splitlines() if part.strip())
        return candidates

    candidates = [text]
    if '\\"' in text:
        candidates.append(text.replace('\\"', '"'))

    for candidate in candidates:
        records: list[dict[str, Any]] = []
        seen_signatures: set[tuple[Optional[str], str]] = set()

        def append_parsed(parsed: dict[str, Any]) -> None:
            signature = (parsed["record_id"], parsed["body"])
            if signature in seen_signatures:
                return
            seen_signatures.add(signature)
            parsed["record_index"] = len(records) + 1
            records.append(parsed)

        for quoted in re.finditer(r'"(?:\\.|[^"\\])*"', candidate, re.S):
            wrapped = quoted.group(0)
            try:
                decoded = json.loads(wrapped)
            except json.JSONDecodeError:
                decoded = wrapped[1:-1]
                decoded = decoded.replace('\\"', '"').replace("\\r\\n", "\n").replace("\\n", "\n")
            if not isinstance(decoded, str) or not decoded.strip():
                continue
            for fragment in expand_line_candidates(decoded):
                if not (fragment.startswith("{") and fragment.endswith("}")):
                    continue
                parsed = parse_object_line(fragment)
                if parsed:
                    append_parsed(parsed)

        for line in candidate.splitlines():
            for expanded_line in expand_line_candidates(line):
                if not (expanded_line.startswith("{") and expanded_line.endswith("}")):
                    continue
                parsed = parse_object_line(expanded_line)
                if parsed:
                    append_parsed(parsed)

        relaxed = candidate.replace('\\"', '"')
        for matched in re.finditer(r"\{[^{}]+\}", relaxed):
            parsed = parse_object_line(matched.group(0))
            if parsed:
                append_parsed(parsed)
        if records:
            return records
    return []


def _extract_tagged_records(text: str, schema: dict[str, Any]) -> list[dict[str, Any]]:
    field_map = schema["field_map"]
    id_key = field_map.get("id", "MSGID")
    text_key = field_map.get("text", "MSG")
    url_key = field_map.get("url", "LINK")
    time_key = field_map.get("time", "DATE")
    meta_key = field_map.get("meta", "META")
    type_key = field_map.get("type", "TYPE")
    author_key = field_map.get("author", "AUTH")
    pair_separator = schema["pair_separator"]
    lines = [part.strip() for part in text.split(schema["record_separator"]) if part.strip()]
    records: list[dict[str, Any]] = []
    for line in lines:
        fields: dict[str, str] = {}
        chunks = [chunk.strip() for chunk in line.split(pair_separator) if chunk.strip()]
        for chunk in chunks:
            for delimiter in ("：", ":"):
                if delimiter in chunk:
                    key, value = chunk.split(delimiter, 1)
                    fields[key.strip().upper()] = value.strip()
                    break
        body = fields.get(text_key, "")
        if not body:
            continue
        records.append(
            {
                "record_id": fields.get(id_key),
                "record_type": fields.get(type_key, "message"),
                "record_index": len(records) + 1,
                "body": body,
                "url": fields.get(url_key),
                "time": fields.get(time_key),
                "meta": fields.get(meta_key),
                "author": fields.get(author_key),
            }
        )
    return records


def _extract_structured_records(text: str) -> list[dict[str, Any]]:
    pattern = re.compile(
        r"(?:(?<=\n)|^)(?P<record_id>[a-zA-Z][\w-]*-\d+):\s*(?P<body>.*?)(?=(?:\n[a-zA-Z][\w-]*-\d+:)|\Z)",
        re.S,
    )
    records = []
    for index, matched in enumerate(pattern.finditer(text), start=1):
        body = matched.group("body").strip()
        if not body:
            continue
        records.append(
            {
                "record_id": matched.group("record_id"),
                "body": body,
                "record_index": index,
                "record_type": "message",
                "url": None,
                "time": None,
                "meta": None,
                "author": None,
            }
        )
    return records


def _capture_outputs_to_clean_items(
    request: FetchRequest,
    script_result: Any,
    capture_key: str,
    outputs: list[str],
    now: datetime,
) -> list[CleanItem]:
    text = _truncate_text("\n".join(output for output in outputs if output))
    if not text:
        text = f"Capture '{capture_key}' completed with {len(outputs)} executions"
        return [
            CleanItem(
                title=f"agent-browser capture: {capture_key}",
                text=text,
                markdown=f"### {capture_key}\n\n```\n{text}\n```",
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=now,
                recordTime=now,
                driver="agent-browser",
                instanceId=script_result.instance_id,
                tabId=script_result.tab_id,
                instanceActive=script_result.instance_active,
                recordId=f"{request.source_id}:{capture_key}:1",
                recordType="capture",
                recordContent={"text": text},
            )
        ]

    normalized = _normalize_capture_text(text)
    schema = _resolve_record_schema(request.config)
    records: list[dict[str, Any]] = []
    if schema["format"] in {"auto", "jsonl"}:
        records = _extract_jsonl_records(normalized)
    if not records and schema["format"] in {"auto", "tagged"}:
        records = _extract_tagged_records(normalized, schema)
    if not records and schema["format"] in {"auto", "legacy"}:
        records = _extract_structured_records(normalized)

    if not records:
        return [
            CleanItem(
                title=f"agent-browser capture: {capture_key}",
                text=text,
                markdown=f"### {capture_key}\n\n```\n{text}\n```",
                platform=request.platform,
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=now,
                recordTime=now,
                driver="agent-browser",
                instanceId=script_result.instance_id,
                tabId=script_result.tab_id,
                instanceActive=script_result.instance_active,
                recordId=f"{request.source_id}:{capture_key}:1",
                recordType="capture",
                recordContent={"text": text},
            )
        ]

    items: list[CleanItem] = []
    for record in records:
        record_title = record["record_id"] or f"{capture_key} #{record['record_index']}"
        markdown = f"### {record_title}\n\n{record['body']}"
        if record.get("meta"):
            markdown = f"{markdown}\n\n> meta: {record['meta']}"
        record_time = now
        raw_time = record.get("time")
        if isinstance(raw_time, str):
            parsed_time = None
            for candidate in (raw_time, raw_time.replace("Z", "+00:00")):
                try:
                    parsed_time = datetime.fromisoformat(candidate)
                    break
                except ValueError:
                    continue
            if parsed_time is not None:
                record_time = parsed_time

        items.append(
            CleanItem(
                title=f"agent-browser {capture_key}: {record_title}",
                text=record["body"],
                markdown=markdown,
                platform=request.platform,
                url=record.get("url"),
                sourceId=request.source_id,
                sourceType="SOCIAL_MEDIA",
                time=record_time,
                recordTime=record_time,
                driver="agent-browser",
                instanceId=script_result.instance_id,
                tabId=script_result.tab_id,
                instanceActive=script_result.instance_active,
                recordId=record["record_id"] or f"{request.source_id}:{capture_key}:{record['record_index']}",
                recordType=record.get("record_type", "message"),
                recordIndex=record["record_index"],
                recordContent={
                    "text": record["body"],
                    "url": record.get("url"),
                    "meta": record.get("meta"),
                    "author": record.get("author"),
                },
            )
        )
    return items


def agent_browser_results_to_clean_items(request: FetchRequest, script_result: Any) -> list[CleanItem]:
    now = datetime.now()
    items: list[CleanItem] = []
    captures = script_result.captures
    if captures:
        for capture_key, outputs in captures.items():
            items.extend(
                _capture_outputs_to_clean_items(
                    request=request,
                    script_result=script_result,
                    capture_key=capture_key,
                    outputs=outputs,
                    now=now,
                )
            )
    if items:
        return items

    step_summary = [
        {
            "step_index": result.step_index,
            "attempt": result.attempt,
            "command": result.command,
            "stdout": _truncate_text(result.stdout.strip(), 2000),
        }
        for result in script_result.step_results
    ]
    summary_text = _truncate_text(json.dumps(step_summary, ensure_ascii=False))
    return [
        CleanItem(
            title="agent-browser execution summary",
            text=summary_text,
            markdown=f"```json\n{summary_text}\n```",
            platform=request.platform,
            sourceId=request.source_id,
            sourceType="SOCIAL_MEDIA",
            time=now,
            recordTime=now,
            driver="agent-browser",
            instanceId=script_result.instance_id,
            tabId=script_result.tab_id,
            instanceActive=script_result.instance_active,
            recordId=f"{request.source_id}:execution-summary",
            recordType="execution-summary",
            recordContent={"text": summary_text},
        )
    ]


def _resolve_keyword_filter(config: Dict[str, Any]) -> Any:
    raw_filter = config.get("keywordFilter")
    if raw_filter is not None:
        return raw_filter
    filters = config.get("filters")
    if isinstance(filters, dict):
        candidate = filters.get("keyword")
        if candidate is not None:
            return candidate
    agent_browser_options = config.get("agentBrowser")
    if isinstance(agent_browser_options, dict):
        nested_filters = agent_browser_options.get("filters")
        if isinstance(nested_filters, dict):
            return nested_filters.get("keyword")
    return None


def _extract_keyword_filter_keywords(config: Dict[str, Any]) -> Optional[List[str]]:
    raw_filter = _resolve_keyword_filter(config)
    raw_keywords: Any = None
    if raw_filter is None:
        raw_keywords = config.get("keywords")
        if raw_keywords is None:
            return None
    elif isinstance(raw_filter, dict):
        if raw_filter.get("enabled", True) is False:
            return None
        raw_keywords = raw_filter.get("keywords", raw_filter.get("terms"))
    else:
        raise KeywordFilterConfigError("config.keywordFilter or config.filters.keyword must be an object")

    if not isinstance(raw_keywords, list):
        raise KeywordFilterConfigError("keyword filter keywords must be a string array")
    normalized: list[str] = []
    for index, value in enumerate(raw_keywords):
        if not isinstance(value, str):
            raise KeywordFilterConfigError(f"keyword filter keywords[{index}] must be string")
        keyword = value.strip()
        if not keyword:
            raise KeywordFilterConfigError(f"keyword filter keywords[{index}] must not be empty")
        normalized.append(keyword.lower())
    unique_keywords = list(dict.fromkeys(normalized))
    if not unique_keywords:
        raise KeywordFilterConfigError("keyword filter keywords must not be empty")
    return unique_keywords


def _extract_keyword_filter_options(config: Dict[str, Any]) -> dict[str, Any]:
    raw_filter = _resolve_keyword_filter(config)
    if raw_filter is None:
        return {"match_scope": "item", "split_mode": "auto"}
    if not isinstance(raw_filter, dict):
        raise KeywordFilterConfigError("config.keywordFilter or config.filters.keyword must be an object")

    raw_scope = raw_filter.get("matchScope", raw_filter.get("scope", "item"))
    if raw_scope not in {"item", "segment"}:
        raise KeywordFilterConfigError("keyword filter matchScope must be item or segment")
    raw_split_mode = raw_filter.get("splitMode", raw_filter.get("segmentSplit", "auto"))
    if raw_split_mode not in {"auto", "line", "paragraph"}:
        raise KeywordFilterConfigError("keyword filter splitMode must be auto, line, or paragraph")
    min_segment_chars = raw_filter.get("minChars", raw_filter.get("minSegmentChars", 1))
    if not isinstance(min_segment_chars, int) or min_segment_chars < 1:
        raise KeywordFilterConfigError("keyword filter minChars must be a positive integer")

    return {
        "match_scope": raw_scope,
        "split_mode": raw_split_mode,
        "min_segment_chars": min_segment_chars,
    }


def _keyword_filter_text(item: CleanItem) -> str:
    parts = [item.title or "", item.text or "", item.markdown or "", item.url or ""]
    return " ".join(part for part in parts if part).lower()


def _split_text_segments(text: str, split_mode: str, min_segment_chars: int) -> list[str]:
    if split_mode == "line":
        raw_segments = text.splitlines()
    elif split_mode == "paragraph":
        raw_segments = re.split(r"\n\s*\n+", text)
    else:
        raw_segments = re.split(r"\n\s*\n+", text) if "\n\n" in text else text.splitlines()
    segments: list[str] = []
    for segment in raw_segments:
        normalized = segment.strip()
        if len(normalized) >= min_segment_chars:
            segments.append(normalized)
    return segments


def _apply_keyword_segment_filter(item: CleanItem, keywords: list[str], options: dict[str, Any]) -> list[CleanItem]:
    segments = _split_text_segments(
        item.text or item.markdown or "",
        split_mode=options["split_mode"],
        min_segment_chars=options["min_segment_chars"],
    )
    if not segments:
        return []
    matched_items: list[CleanItem] = []
    for index, segment in enumerate(segments, start=1):
        haystack = segment.lower()
        matched = [keyword for keyword in keywords if keyword in haystack]
        if not matched:
            continue
        matched_items.append(
            item.model_copy(
                update={
                    "title": f"{item.title or item.platform} [segment {index}]",
                    "text": segment,
                    "markdown": segment,
                    "matchedKeywords": matched,
                    "keywordMatchScore": round(len(matched) / len(keywords), 4),
                }
            )
        )
    return matched_items


def apply_keyword_hard_filter(request: FetchRequest, items: List[CleanItem]) -> List[CleanItem]:
    try:
        keywords = _extract_keyword_filter_keywords(request.config)
        options = _extract_keyword_filter_options(request.config)
    except KeywordFilterConfigError as error:
        print(
            f"[gather][keyword-filter][error] "
            f"{json.dumps({'sourceId': request.source_id, 'platform': request.platform, 'error': str(error)}, ensure_ascii=False)}"
        )
        raise HTTPException(status_code=400, detail=f"keyword filter invalid config: {error}") from error

    if not keywords:
        return items
    filtered: list[CleanItem] = []
    hit = 0
    miss = 0
    fetched = len(items)
    for item in items:
        if options["match_scope"] == "segment":
            segment_hits = _apply_keyword_segment_filter(item, keywords, options)
            if segment_hits:
                filtered.extend(segment_hits)
                hit += 1
                continue
        else:
            haystack = _keyword_filter_text(item)
            matched = [keyword for keyword in keywords if keyword in haystack]
            if matched:
                item.matchedKeywords = matched
                item.keywordMatchScore = round(len(matched) / len(keywords), 4)
                filtered.append(item)
                hit += 1
                continue
        miss += 1
        print(
            f"[gather][keyword-filter][audit] "
            f"{json.dumps({'sourceId': item.sourceId, 'platform': item.platform, 'url': item.url, 'reason': 'keyword_miss'}, ensure_ascii=False)}"
        )

    print(
        f"[gather][keyword-filter][metrics] "
        f"{json.dumps({'sourceId': request.source_id, 'platform': request.platform, 'fetched': fetched, 'hit': hit, 'miss': miss, 'persisted': len(filtered), 'matchScope': options['match_scope']}, ensure_ascii=False)}"
    )
    return filtered
