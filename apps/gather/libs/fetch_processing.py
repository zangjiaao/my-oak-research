import json
import re
import unicodedata
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from schemas import CleanItem, FetchRequest, KeywordFilterConfigError


def _truncate_text(value: str, max_length: int = 12000) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[:max_length]}..."


def _resolve_keyword_filter(config: Dict[str, Any]) -> Any:
    raw_filter = config.get("keywordFilter")
    if raw_filter is not None:
        return raw_filter
    filters = config.get("filters")
    if isinstance(filters, dict):
        candidate = filters.get("keyword")
        if candidate is not None:
            return candidate
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
        return {
            "min_chars": 1,
            "include_fields": [],
            "exclude_fields": ["url"],
            "match_mode": "smart",
            "min_cjk_term_chars": 2,
        }
    if not isinstance(raw_filter, dict):
        raise KeywordFilterConfigError("config.keywordFilter or config.filters.keyword must be an object")

    if "splitMode" in raw_filter or "segmentSplit" in raw_filter:
        raise KeywordFilterConfigError("keyword filter splitMode has been removed")
    if "matchScope" in raw_filter or "scope" in raw_filter:
        raise KeywordFilterConfigError("keyword filter matchScope has been removed")

    min_chars = raw_filter.get("minChars", raw_filter.get("minSegmentChars", 1))
    if not isinstance(min_chars, int) or min_chars < 1:
        raise KeywordFilterConfigError("keyword filter minChars must be a positive integer")
    match_mode = raw_filter.get("matchMode", "smart")
    if not isinstance(match_mode, str) or match_mode not in {
        "smart",
        "contains",
        "term_and_word_boundary",
    }:
        raise KeywordFilterConfigError(
            "keyword filter matchMode must be one of: smart, contains, term_and_word_boundary"
        )
    min_cjk_term_chars = raw_filter.get("minCjkTermChars", 2)
    if not isinstance(min_cjk_term_chars, int) or min_cjk_term_chars < 1:
        raise KeywordFilterConfigError("keyword filter minCjkTermChars must be a positive integer")
    raw_include_fields = raw_filter.get("includeFields", raw_filter.get("scopeFields", raw_filter.get("keywordScope")))
    raw_exclude_fields = raw_filter.get("excludeFields")
    include_fields: list[str] = []
    exclude_fields: list[str] = []
    if raw_include_fields is not None:
        if not isinstance(raw_include_fields, list):
            raise KeywordFilterConfigError("keyword filter includeFields must be a string array")
        for index, value in enumerate(raw_include_fields):
            if not isinstance(value, str) or not value.strip():
                raise KeywordFilterConfigError(f"keyword filter includeFields[{index}] must be non-empty string")
            include_fields.append(value.strip())
    if raw_exclude_fields is not None:
        if not isinstance(raw_exclude_fields, list):
            raise KeywordFilterConfigError("keyword filter excludeFields must be a string array")
        for index, value in enumerate(raw_exclude_fields):
            if not isinstance(value, str) or not value.strip():
                raise KeywordFilterConfigError(f"keyword filter excludeFields[{index}] must be non-empty string")
            exclude_fields.append(value.strip())

    if not exclude_fields and not include_fields:
        # default keep existing behavior: URL excluded
        exclude_fields = ["url"]

    return {
        "min_chars": min_chars,
        "include_fields": include_fields,
        "exclude_fields": exclude_fields,
        "match_mode": match_mode,
        "min_cjk_term_chars": min_cjk_term_chars,
    }


def _normalize_keyword_filter_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return " ".join(normalized.split())


def _contains_cjk(value: str) -> bool:
    return any(
        ("\u4e00" <= char <= "\u9fff")
        or ("\u3400" <= char <= "\u4dbf")
        or ("\u3040" <= char <= "\u30ff")
        or ("\uac00" <= char <= "\ud7af")
        for char in value
    )


def _is_ascii_word(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9_]+", value))


def _collect_record_content_strings(
    value: Any,
    path_prefix: Optional[list[str]] = None,
    exclude_field_paths: Optional[set[str]] = None,
    exclude_field_names: Optional[set[str]] = None,
) -> list[str]:
    path_prefix = path_prefix or []
    exclude_field_paths = exclude_field_paths or set()
    exclude_field_names = exclude_field_names or set()
    if isinstance(value, str):
        stripped = value.strip()
        return [stripped] if stripped else []
    if isinstance(value, dict):
        collected: list[str] = []
        for key, nested in value.items():
            key_normalized = key.strip().lower() if isinstance(key, str) else ""
            if not key_normalized:
                continue
            field_path = ".".join([*path_prefix, key_normalized])
            if key_normalized in exclude_field_names or field_path in exclude_field_paths:
                continue
            collected.extend(
                _collect_record_content_strings(
                    nested,
                    path_prefix=[*path_prefix, key_normalized],
                    exclude_field_paths=exclude_field_paths,
                    exclude_field_names=exclude_field_names,
                )
            )
        return collected
    if isinstance(value, list):
        collected: list[str] = []
        for nested in value:
            collected.extend(
                _collect_record_content_strings(
                    nested,
                    path_prefix=path_prefix,
                    exclude_field_paths=exclude_field_paths,
                    exclude_field_names=exclude_field_names,
                )
            )
        return collected
    return []


def _read_nested_value(payload: dict[str, Any], path: list[str]) -> Any:
    current: Any = payload
    for segment in path:
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current[segment]
    return current


def _keyword_filter_text(
    item: CleanItem,
    include_fields: list[str],
    exclude_fields: list[str],
) -> str:
    record_content = item.recordContent if isinstance(item.recordContent, dict) else {}
    if include_fields:
        parts: list[str] = []
        for field in include_fields:
            path = [segment for segment in field.split(".") if segment]
            if not path:
                continue
            value = _read_nested_value(record_content, path)
            if value is None:
                continue
            parts.extend(_collect_record_content_strings(value))
    else:
        normalized_exclude_fields = [field.strip().lower() for field in exclude_fields if field.strip()]
        exclude_field_paths = set(normalized_exclude_fields)
        exclude_field_names = set(
            field.split(".")[-1] for field in normalized_exclude_fields if field
        )
        parts = _collect_record_content_strings(
            record_content,
            exclude_field_paths=exclude_field_paths,
            exclude_field_names=exclude_field_names,
        )
    return _normalize_keyword_filter_text(" ".join(parts))


def _smart_match_keyword(keyword: str, haystack: str, options: dict[str, Any]) -> tuple[bool, Optional[str]]:
    if not keyword:
        return False, None
    if _is_ascii_word(keyword):
        boundary_pattern = re.compile(rf"(?<!\w){re.escape(keyword)}(?!\w)")
        matched = bool(boundary_pattern.search(haystack))
        return matched, "word" if matched else None
    if _contains_cjk(keyword):
        if len(keyword) < options["min_cjk_term_chars"]:
            return False, None
        matched = keyword in haystack
        return matched, "cjk" if matched else None
    unicode_boundary = re.compile(rf"(?<!\w){re.escape(keyword)}(?!\w)")
    matched = bool(unicode_boundary.search(haystack))
    if matched:
        return True, "unicode-word"
    if " " in keyword:
        phrase_matched = keyword in haystack
        return phrase_matched, "phrase" if phrase_matched else None
    return False, None


def _match_keyword(keyword: str, haystack: str, options: dict[str, Any]) -> tuple[bool, Optional[str]]:
    if options["match_mode"] == "term_and_word_boundary":
        terms = [part.strip() for part in keyword.split() if part.strip()]
        normalized_terms = terms if terms else [keyword]
        for term in normalized_terms:
            matched, _ = _smart_match_keyword(term, haystack, options)
            if not matched:
                return False, None
        return True, "term-and-word-boundary"
    if options["match_mode"] == "contains":
        matched = keyword in haystack
        return matched, "contains" if matched else None
    return _smart_match_keyword(keyword, haystack, options)


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
    keywords = [_normalize_keyword_filter_text(keyword) for keyword in keywords]
    filtered: list[CleanItem] = []
    hit = 0
    miss = 0
    fetched = len(items)
    for item in items:
        haystack = _keyword_filter_text(
            item,
            options["include_fields"],
            options["exclude_fields"],
        )
        if len(haystack.strip()) < options["min_chars"]:
            miss += 1
            print(
                f"[gather][keyword-filter][audit] "
                f"{json.dumps({'sourceId': item.sourceId, 'platform': item.platform, 'url': item.url, 'reason': 'min_chars'}, ensure_ascii=False)}"
            )
            continue
        matched: list[str] = []
        matched_by: dict[str, str] = {}
        for keyword in keywords:
            is_hit, strategy = _match_keyword(keyword, haystack, options)
            if is_hit:
                matched.append(keyword)
                if strategy:
                    matched_by[keyword] = strategy
        if matched:
            item.matchedKeywords = matched
            item.keywordMatchScore = round(len(matched) / len(keywords), 4)
            filtered.append(item)
            hit += 1
            print(
                f"[gather][keyword-filter][audit] "
                f"{json.dumps({'sourceId': item.sourceId, 'platform': item.platform, 'url': item.url, 'reason': 'keyword_hit', 'matchMode': options['match_mode'], 'matchedBy': matched_by}, ensure_ascii=False)}"
            )
            continue
        miss += 1
        print(
            f"[gather][keyword-filter][audit] "
            f"{json.dumps({'sourceId': item.sourceId, 'platform': item.platform, 'url': item.url, 'reason': 'keyword_miss', 'matchMode': options['match_mode']}, ensure_ascii=False)}"
        )

    print(
        f"[gather][keyword-filter][metrics] "
        f"{json.dumps({'sourceId': request.source_id, 'platform': request.platform, 'fetched': fetched, 'hit': hit, 'miss': miss, 'persisted': len(filtered), 'minChars': options['min_chars'], 'includeFields': options['include_fields'], 'excludeFields': options['exclude_fields'], 'matchMode': options['match_mode']}, ensure_ascii=False)}"
    )
    return filtered
