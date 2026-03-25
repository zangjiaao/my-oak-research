"""Script catalog building and listing."""

import json
import re
from typing import Any

from core.config import (
    SCRIPT_ALLOWED_CATEGORIES,
    SCRIPT_REGISTRY,
    SCRIPT_SAMPLE_ENTRY_RE,
    SCRIPT_SAMPLE_LINE_RE,
    SEARCH_INTENTS,
)
from core.io_logging import log_api_io
from core.normalize import _as_dict, _extract_search_query

SCRIPT_META_BLOCK_RE = re.compile(r"/\*\s*@meta\s*([\s\S]*?)\*/", re.MULTILINE)


def _parse_script_sample_payload(script_content: str) -> dict[str, Any]:
    sample: dict[str, Any] = {}
    meta_match = SCRIPT_META_BLOCK_RE.search(script_content)
    if meta_match:
        raw_meta = meta_match.group(1).strip()
        try:
            parsed_meta = json.loads(raw_meta)
        except json.JSONDecodeError:
            parsed_meta = None

        if isinstance(parsed_meta, dict):
            sample["meta"] = parsed_meta
            if isinstance(parsed_meta.get("args"), dict):
                sample["intent.args"] = parsed_meta["args"]
            intent_type = parsed_meta.get("intentType")
            if isinstance(intent_type, str) and intent_type.strip():
                sample["intent.type"] = intent_type.strip()
            output_field = parsed_meta.get("outputField", parsed_meta.get("output"))
            if isinstance(output_field, (list, dict)):
                sample["output.field"] = output_field

            passthrough_keys = [
                "category",
                "title",
                "description",
                "auth",
                "tags",
                "name",
                "domain",
                "capabilities",
                "readOnly",
                "example",
            ]
            for key in passthrough_keys:
                if key in parsed_meta:
                    sample[key] = parsed_meta[key]

    lines = script_content.splitlines()
    in_sample_block = False

    for line in lines:
        if not in_sample_block:
            if SCRIPT_SAMPLE_LINE_RE.match(line):
                in_sample_block = True
            continue

        matched = SCRIPT_SAMPLE_ENTRY_RE.match(line)
        if not matched:
            if line.strip().startswith("//"):
                continue
            break

        raw_key = matched.group(1).strip()
        raw_value = matched.group(2).strip()
        if not raw_key:
            continue
        if raw_key in sample:
            continue
        try:
            sample[raw_key] = json.loads(raw_value)
        except json.JSONDecodeError:
            sample[raw_key] = raw_value

    return sample


def _normalize_script_category(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().upper()
    if not normalized:
        return None
    if normalized in SCRIPT_ALLOWED_CATEGORIES:
        return normalized
    return None


def _normalize_script_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in re.split(r"[,\s]+", value) if part.strip()]
    return []


def _extract_script_meta(sample_payload: dict[str, Any]) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    raw_meta = _as_dict(sample_payload.get("meta"))
    category = _normalize_script_category(raw_meta.get("category", sample_payload.get("category")))
    if category:
        meta["category"] = category
    title = raw_meta.get("title", sample_payload.get("title"))
    if isinstance(title, str) and title.strip():
        meta["title"] = title.strip()
    description = raw_meta.get("description", sample_payload.get("description"))
    if isinstance(description, str) and description.strip():
        meta["description"] = description.strip()

    name = raw_meta.get("name", sample_payload.get("name"))
    if isinstance(name, str) and name.strip():
        meta["name"] = name.strip()
    domain = raw_meta.get("domain", sample_payload.get("domain"))
    if isinstance(domain, str) and domain.strip():
        meta["domain"] = domain.strip()
    capabilities = raw_meta.get("capabilities", sample_payload.get("capabilities"))
    if isinstance(capabilities, list):
        normalized_capabilities = [str(item).strip() for item in capabilities if str(item).strip()]
        if normalized_capabilities:
            meta["capabilities"] = normalized_capabilities
    read_only = raw_meta.get("readOnly", sample_payload.get("readOnly"))
    if isinstance(read_only, bool):
        meta["readOnly"] = read_only
    example = raw_meta.get("example", sample_payload.get("example"))
    if isinstance(example, str) and example.strip():
        meta["example"] = example.strip()
    args_meta = raw_meta.get("args")
    if isinstance(args_meta, dict):
        meta["args"] = args_meta

    auth_raw = raw_meta.get("auth", sample_payload.get("auth"))
    auth_obj = auth_raw if isinstance(auth_raw, dict) else {}
    auth_required = auth_obj.get("required", sample_payload.get("auth.required"))
    auth_kind = auth_obj.get("kind", sample_payload.get("auth.kind"))
    auth_description = auth_obj.get("description", sample_payload.get("auth.description"))

    auth_meta: dict[str, Any] = {}
    if isinstance(auth_required, bool):
        auth_meta["required"] = auth_required
    if isinstance(auth_kind, str) and auth_kind.strip():
        auth_meta["kind"] = auth_kind.strip()
    if isinstance(auth_description, str) and auth_description.strip():
        auth_meta["description"] = auth_description.strip()
    if auth_meta:
        meta["auth"] = auth_meta

    tags = _normalize_script_tags(raw_meta.get("tags", sample_payload.get("tags")))
    if tags:
        meta["tags"] = tags

    return meta


def _normalize_search_intent_args_for_catalog(
    platform: str, intent_args: dict[str, Any]
) -> dict[str, Any]:
    query, _ = _extract_search_query(platform, intent_args, strict=False)
    normalized = dict(intent_args)
    if query:
        normalized["query"] = query
    normalized.pop("keyword", None)
    return normalized


def _build_scripts_catalog() -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    platform_map: dict[str, set[str]] = {}

    for spec in SCRIPT_REGISTRY.list_specs():
        runtime_file = spec.runtime_path if spec.runtime_path.exists() else spec.source_path
        sample_file = spec.source_path if spec.source_path.exists() else runtime_file
        sample_payload: dict[str, Any] = {}

        try:
            script_content = sample_file.read_text(encoding="utf-8")
            sample_payload = _parse_script_sample_payload(script_content)
        except Exception:
            sample_payload = {}

        sample_intent = _as_dict(sample_payload.get("intent.args"))
        if spec.intent in SEARCH_INTENTS:
            sample_intent = _normalize_search_intent_args_for_catalog(
                spec.platform,
                sample_intent,
            )
        sample_output = sample_payload.get("output.field")
        script_meta = _extract_script_meta(sample_payload)

        item = {
            "key": spec.key,
            "platform": spec.platform.upper(),
            "intent": spec.intent,
            "mode": spec.mode,
            "runtimePath": str(runtime_file),
            "sample": {
                "intentType": sample_payload.get("intent.type", spec.intent),
                "intentArgs": sample_intent,
                "outputField": sample_output if isinstance(sample_output, (list, dict)) else None,
            },
            "meta": script_meta,
        }
        items.append(item)
        platform_map.setdefault(item["platform"], set()).add(spec.intent)

    platforms = [
        {"platform": platform, "intents": sorted(intents)}
        for platform, intents in sorted(platform_map.items(), key=lambda entry: entry[0])
    ]

    return {
        "total": len(items),
        "items": sorted(items, key=lambda entry: (entry["platform"], entry["intent"])),
        "platforms": platforms,
    }


async def list_scripts_catalog():
    payload = _build_scripts_catalog()
    log_api_io("/v1/scripts/catalog", {}, payload, 200)
    return payload
