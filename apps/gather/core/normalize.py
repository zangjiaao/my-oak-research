"""Request normalization and output-field mapping."""

import json
import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import ValidationError

from core.config import (
    GATHER_APP_ROOT,
    SEARCH_ALIAS_COMPAT_ENABLED,
    SEARCH_INTENTS,
    V3_DRIVER_STRATEGIES,
    X_INTERCEPT_INTENTS,
    REDDIT_INTERCEPT_INTENTS,
    XHS_INTERCEPT_INTENTS,
    BBC_INTERCEPT_INTENTS,
    HACKERNEWS_INTERCEPT_INTENTS,
    LINKEDIN_INTERCEPT_INTENTS,
    LINUX_DO_INTERCEPT_INTENTS,
    YOUTUBE_INTERCEPT_INTENTS,
    WEIBO_INTERCEPT_INTENTS,
    ZHIHU_INTERCEPT_INTENTS,
    BILIBILI_INTERCEPT_INTENTS,
    KR36_INTERCEPT_INTENTS,
    ARXIV_INTERCEPT_INTENTS,
    BAIDU_INTERCEPT_INTENTS,
    BING_INTERCEPT_INTENTS,
    CNBLOGS_INTERCEPT_INTENTS,
    CSDN_INTERCEPT_INTENTS,
    CTRIP_INTERCEPT_INTENTS,
    DEVTO_INTERCEPT_INTENTS,
    DUCKDUCKGO_INTERCEPT_INTENTS,
    GOOGLE_INTERCEPT_INTENTS,
    REUTERS_INTERCEPT_INTENTS,
    TOUTIAO_INTERCEPT_INTENTS,
    HUPU_INTERCEPT_INTENTS,
)
from schemas import (
    CleanItem,
    FetchApiRequest,
    FetchMeta,
    FetchRequest,
)

logger = logging.getLogger("gather")


# ---------------------------------------------------------------------------
# Sentinel
# ---------------------------------------------------------------------------

_MISSING = object()


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------

def truncate_text(value: str, max_length: int = 12000) -> str:
    if len(value) <= max_length:
        return value
    return f"{value[:max_length]}..."


def extract_x_status_id(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    matched = re.search(r"/status/(\d+)", url)
    return matched.group(1) if matched else None


def extract_tweet_id(raw: Any) -> str:
    if raw is None:
        return ""
    if isinstance(raw, (int, float)):
        if isinstance(raw, float) and not raw.is_integer():
            return ""
        raw = str(int(raw))
    if not isinstance(raw, str):
        return ""
    value = raw.strip()
    if not value:
        return ""
    matched = re.search(r"/status/(\d+)", value)
    if matched:
        return matched.group(1)
    digits = re.sub(r"\D", "", value)
    return digits if digits else value


# ---------------------------------------------------------------------------
# CleanItem normalization
# ---------------------------------------------------------------------------

def normalize_clean_items(raw_items: list[Any]) -> list[CleanItem]:
    normalized: list[CleanItem] = []
    for item in raw_items:
        if isinstance(item, CleanItem):
            normalized.append(item)
            continue
        try:
            normalized.append(CleanItem.model_validate(item))
        except ValidationError as error:
            raise HTTPException(
                status_code=500,
                detail=f"driver returned invalid item payload: {error.errors()[0].get('msg', 'validation failed')}",
            ) from error
    return normalized


# ---------------------------------------------------------------------------
# Nested field read/write
# ---------------------------------------------------------------------------

def _read_nested_field(payload: dict[str, Any], path: list[str]) -> Any:
    current: Any = payload
    for segment in path:
        if not isinstance(current, dict) or segment not in current:
            return _MISSING
        current = current[segment]
    return current


def _write_nested_field(payload: dict[str, Any], path: list[str], value: Any) -> None:
    current = payload
    for segment in path[:-1]:
        next_value = current.get(segment)
        if not isinstance(next_value, dict):
            next_value = {}
            current[segment] = next_value
        current = next_value
    current[path[-1]] = value


def _parse_record_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        for candidate in (value, value.replace("Z", "+00:00")):
            try:
                return datetime.fromisoformat(candidate)
            except ValueError:
                continue
        try:
            return datetime.strptime(value, "%a %b %d %H:%M:%S %z %Y")
        except ValueError:
            return None
    return None


def _resolve_source_path(source: dict[str, Any], source_path: list[str]) -> list[str]:
    if not source_path:
        return source_path
    if source_path[0] in source:
        return source_path
    list_aliases = ("tweets", "items", "posts", "results", "data", "notes")
    if len(source_path) > 1 and source_path[0] in list_aliases:
        if source_path[1] in source:
            return source_path[1:]
        for alias in list_aliases:
            if isinstance(source.get(alias), list):
                return [alias, *source_path[1:]]
    if source_path[0] == "text":
        for key in list_aliases:
            if isinstance(source.get(key), list):
                return [key, *source_path[1:]]
    return source_path


# ---------------------------------------------------------------------------
# Output field mapping
# ---------------------------------------------------------------------------

def _apply_output_field_map(
    item: CleanItem, source: dict[str, Any], output_field_map: dict[str, str]
) -> list[CleanItem]:
    mappings: list[tuple[list[str], list[str]]] = []
    for target_field, source_field in output_field_map.items():
        if not isinstance(target_field, str) or not target_field.strip():
            continue
        if not isinstance(source_field, str) or not source_field.strip():
            continue
        target_path = [segment for segment in target_field.strip().split(".") if segment]
        source_path = [segment for segment in source_field.strip().split(".") if segment]
        if not target_path or not source_path:
            continue
        mappings.append((target_path, _resolve_source_path(source, source_path)))

    if not mappings:
        item.recordContent = {}
        return [item]

    list_prefixes = {
        source_path[0]
        for _, source_path in mappings
        if len(source_path) > 1 and isinstance(source.get(source_path[0]), list)
    }
    if len(list_prefixes) == 1:
        list_key = next(iter(list_prefixes))
        list_mappings: list[tuple[list[str], list[str]]] = []
        scalar_mappings: list[tuple[list[str], list[str]]] = []
        for target_path, source_path in mappings:
            if len(source_path) > 1 and source_path[0] == list_key:
                list_mappings.append((target_path, source_path))
            else:
                scalar_mappings.append((target_path, source_path))

        raw_rows = source.get(list_key, [])
        if list_mappings and isinstance(raw_rows, list):
            expanded: list[CleanItem] = []
            for index, row in enumerate(raw_rows, start=1):
                if not isinstance(row, dict):
                    continue
                mapped_content: dict[str, Any] = {}
                has_list_values = False
                for target_path, source_path in list_mappings:
                    value = _read_nested_field(row, source_path[1:])
                    if value is _MISSING:
                        continue
                    has_list_values = True
                    _write_nested_field(mapped_content, target_path, value)
                if not has_list_values:
                    continue
                for target_path, source_path in scalar_mappings:
                    value = _read_nested_field(source, source_path)
                    if value is _MISSING:
                        continue
                    _write_nested_field(mapped_content, target_path, value)
                if not mapped_content:
                    continue
                cloned = item.model_copy(deep=True)
                cloned.recordContent = mapped_content
                mapped_id = mapped_content.get("id")
                if isinstance(mapped_id, str) and mapped_id.strip():
                    cloned.recordId = mapped_id.strip()
                else:
                    base_record_id = (
                        cloned.recordId.strip()
                        if isinstance(cloned.recordId, str) and cloned.recordId.strip()
                        else item.sourceId
                    )
                    cloned.recordId = f"{base_record_id}:{index}"
                mapped_time = mapped_content.get("time", mapped_content.get("created_at"))
                parsed_time = _parse_record_time(mapped_time)
                if parsed_time is not None:
                    cloned.recordTime = parsed_time
                mapped_url = mapped_content.get("url")
                if isinstance(mapped_url, str) and mapped_url.strip():
                    cloned.url = mapped_url.strip()
                cloned.recordIndex = index
                expanded.append(cloned)
            if expanded:
                return expanded

    mapped_content_dict: dict[str, Any] = {}
    for target_path, source_path in mappings:
        value = _read_nested_field(source, source_path)
        if value is _MISSING:
            continue
        _write_nested_field(mapped_content_dict, target_path, value)
    item.recordContent = mapped_content_dict
    return [item]


def apply_output_fields(
    items: list[CleanItem],
    output_fields: Optional[List[str]],
    output_field_map: Optional[dict[str, str]],
) -> list[CleanItem]:
    if not output_fields and not output_field_map:
        return items

    transformed_items: list[CleanItem] = []
    for item in items:
        source = item.recordContent if isinstance(item.recordContent, dict) else {}
        if output_field_map:
            transformed_items.extend(_apply_output_field_map(item, source, output_field_map))
            continue

        filtered: dict[str, Any] = {}
        for raw_field in output_fields or []:
            if not isinstance(raw_field, str):
                continue
            field = raw_field.strip()
            if not field:
                continue
            if field == "*":
                filtered = dict(source)
                break
            path = [segment for segment in field.split(".") if segment]
            if not path:
                continue
            value = _read_nested_field(source, path)
            if value is _MISSING:
                continue
            _write_nested_field(filtered, path, value)
        item.recordContent = filtered
        transformed_items.append(item)
    return transformed_items


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _extract_search_query(
    platform: str,
    intent_args: dict[str, Any],
    strict: bool,
) -> tuple[str, bool]:
    raw_query = intent_args.get("query")
    if isinstance(raw_query, str) and raw_query.strip():
        return raw_query.strip(), False

    raw_keyword = intent_args.get("keyword")
    if isinstance(raw_keyword, str) and raw_keyword.strip():
        if not SEARCH_ALIAS_COMPAT_ENABLED:
            raise HTTPException(
                status_code=400,
                detail=f"driver.script.args.query is required for {platform or 'unknown'} search intent",
            )
        return raw_keyword.strip(), True

    if strict:
        raise HTTPException(
            status_code=400,
            detail=f"driver.script.args.query is required for {platform or 'unknown'} search intent",
        )
    return "", False


# ---------------------------------------------------------------------------
# Normalize API request → internal FetchRequest
# ---------------------------------------------------------------------------

def normalize_fetch_request(
    request: FetchApiRequest,
) -> tuple[FetchRequest, str, FetchMeta]:
    driver_name = "playwright"
    driver_option: dict[str, Any] = {}
    driver_filter: dict[str, Any] = {}
    if request.driver is not None:
        if request.driver.name and request.driver.name.strip():
            driver_name = request.driver.name.strip()
        driver_filter = dict(request.driver.filter)
        dumped_driver = request.driver.model_dump(by_alias=True, exclude_none=True)
        for reserved in ("name", "script", "filter"):
            dumped_driver.pop(reserved, None)
        driver_option = dumped_driver
    driver_name = driver_name.strip().lower()

    request_intent = request.driver.script if request.driver is not None else None
    intent_type = request_intent.type.strip().lower() if request_intent and request_intent.type.strip() else "search"
    intent_args = dict(request_intent.args) if request_intent and isinstance(request_intent.args, dict) else {}
    adapter = f"{request.platform.lower().strip()}.{intent_type}"
    driver_option = merge_intent_into_driver_option(
        request.platform,
        intent_type,
        intent_args,
        driver_name,
        driver_option,
    )

    normalized_user_id = request.user_id.strip() if isinstance(request.user_id, str) else ""
    config: dict[str, Any] = dict(driver_option)

    if driver_name == "playwright":
        network = config.pop("network", None)
        playwright_option = dict(config)
        if normalized_user_id and not str(playwright_option.get("userId", "")).strip():
            playwright_option["userId"] = normalized_user_id
        config = {"playwright": playwright_option}
        if network is not None:
            config["network"] = network

    output = request.output.model_dump()
    output_fields: list[str] = []
    output_field_map: dict[str, str] = {}
    output_keyword_scope: list[str] = []
    output_type: str | None = None
    raw_fields = output.get("field")
    if isinstance(raw_fields, dict):
        output_field_map = {
            key.strip(): value.strip()
            for key, value in raw_fields.items()
            if isinstance(key, str) and key.strip()
            and isinstance(value, str) and value.strip()
        }
    elif isinstance(raw_fields, list):
        output_fields = [value for value in raw_fields if isinstance(value, str) and value.strip()]
    raw_keyword_scope = output.get("keywordScope")
    if isinstance(raw_keyword_scope, list):
        output_keyword_scope = [
            value.strip()
            for value in raw_keyword_scope
            if isinstance(value, str) and value.strip()
        ]
    raw_output_type = output.get("type")
    if isinstance(raw_output_type, str) and raw_output_type.strip():
        output_type = raw_output_type.strip()

    if request.keywords:
        existing_filters = _as_dict(config.get("filters"))
        keyword_filter = {
            **_as_dict(existing_filters.get("keyword")),
            **driver_filter,
            "keywords": request.keywords,
        }
        if output_keyword_scope:
            keyword_filter["scopeFields"] = output_keyword_scope
        config["filters"] = {
            **existing_filters,
            "keyword": keyword_filter,
        }

    normalized_request = FetchRequest(
        platform=request.platform,
        config=config,
        source_id=request.source_id,
        user_id=normalized_user_id or None,
        keywords=request.keywords,
        output_fields=output_fields or None,
        output_field_map=output_field_map or None,
        output_keyword_scope=output_keyword_scope or None,
        output_type=output_type,
    )

    strategy_tried = V3_DRIVER_STRATEGIES.get(driver_name, [driver_name or "playwright"])
    meta = FetchMeta(
        adapter=adapter,
        strategyTried=strategy_tried,
        strategyUsed=strategy_tried[0],
        driverUsed=driver_name,
    )
    return normalized_request, driver_name, meta


# ---------------------------------------------------------------------------
# Intent → driver option merge
# ---------------------------------------------------------------------------

def merge_intent_into_driver_option(
    platform: str,
    intent_type: str,
    intent_args: dict[str, Any],
    driver_name: str,
    option: dict[str, Any],
) -> dict[str, Any]:
    merged_option = dict(option)
    normalized_platform = (platform or "").strip().lower()
    normalized_query, used_alias = _extract_search_query(
        normalized_platform,
        intent_args,
        strict=intent_type in SEARCH_INTENTS,
    )
    if used_alias:
        logger.warning(
            "deprecated intent arg 'keyword' used (use 'query' instead): platform=%s intent=%s",
            normalized_platform, intent_type,
        )

    query = normalized_query
    subreddit = intent_args.get("subreddit", intent_args.get("name"))
    sort = intent_args.get("sort")
    time_filter = intent_args.get("time")
    username = intent_args.get("username")
    xhs_user_id = intent_args.get("id", intent_args.get("user_id"))
    tweet_id = intent_args.get("tweet_id", intent_args.get("tweetId"))
    question_id = intent_args.get("id", intent_args.get("question_id", intent_args.get("questionId")))
    bvid = intent_args.get("bvid", intent_args.get("id"))
    url = intent_args.get("url")
    limit = intent_args.get("limit")
    normalized_query = query.strip() if isinstance(query, str) else ""
    normalized_subreddit = subreddit.strip() if isinstance(subreddit, str) else ""
    normalized_username = username.strip().lstrip("@") if isinstance(username, str) else ""
    normalized_xhs_user_id = xhs_user_id.strip() if isinstance(xhs_user_id, str) else ""
    if normalized_username.lower().startswith("u/"):
        normalized_username = normalized_username[2:]
    normalized_tweet_id = extract_tweet_id(tweet_id)
    normalized_question_id = str(question_id).strip() if question_id is not None else ""
    normalized_bvid = str(bvid).strip() if bvid is not None else ""
    if not normalized_tweet_id and isinstance(url, str):
        normalized_tweet_id = extract_tweet_id(url)
    normalized_limit = limit if isinstance(limit, int) and limit > 0 else None

    if driver_name == "playwright":
        args = merged_option.get("args")
        args_obj: dict[str, Any] = {}
        if isinstance(intent_args, dict):
            args_obj.update(intent_args)
        if isinstance(args, dict):
            args_obj.update(args)
        if intent_type == "search":
            if normalized_query and (not isinstance(args_obj.get("query"), str) or not args_obj.get("query")):
                args_obj["query"] = normalized_query
            if (platform or "").strip().lower() == "x" and "type" not in args_obj:
                args_obj["type"] = "latest"
            if normalized_platform in {"linux-do", "linuxdo", "zhihu", "bilibili"}:
                if normalized_query and "keyword" not in args_obj:
                    args_obj["keyword"] = normalized_query
            if normalized_platform == "linkedin":
                if isinstance(intent_args.get("location"), str) and "location" not in args_obj:
                    args_obj["location"] = intent_args.get("location")
                if isinstance(intent_args.get("company"), str) and "company" not in args_obj:
                    args_obj["company"] = intent_args.get("company")
                experience_level = intent_args.get("experience_level", intent_args.get("experienceLevel"))
                if isinstance(experience_level, str) and "experience_level" not in args_obj:
                    args_obj["experience_level"] = experience_level
                job_type = intent_args.get("job_type", intent_args.get("jobType"))
                if isinstance(job_type, str) and "job_type" not in args_obj:
                    args_obj["job_type"] = job_type
                date_posted = intent_args.get("date_posted", intent_args.get("datePosted"))
                if isinstance(date_posted, str) and "date_posted" not in args_obj:
                    args_obj["date_posted"] = date_posted
                if isinstance(intent_args.get("remote"), str) and "remote" not in args_obj:
                    args_obj["remote"] = intent_args.get("remote")
                start_arg = intent_args.get("start")
                if isinstance(start_arg, int) and "start" not in args_obj:
                    args_obj["start"] = start_arg
                details_arg = intent_args.get("details")
                if isinstance(details_arg, bool) and "details" not in args_obj:
                    args_obj["details"] = details_arg
                if normalized_query:
                    args_obj["query"] = normalized_query
        if intent_type in {"subreddit", "hot"}:
            if normalized_subreddit and (not isinstance(args_obj.get("subreddit"), str) or not args_obj.get("subreddit")):
                args_obj["subreddit"] = normalized_subreddit
            if normalized_subreddit and (not isinstance(args_obj.get("name"), str) or not args_obj.get("name")):
                args_obj["name"] = normalized_subreddit
        if intent_type in {"profile", "followers", "following", "tweets"}:
            if normalized_username and (not isinstance(args_obj.get("username"), str) or not args_obj.get("username")):
                args_obj["username"] = normalized_username
        if intent_type == "user":
            if normalized_username and (not isinstance(args_obj.get("username"), str) or not args_obj.get("username")):
                args_obj["username"] = normalized_username
            if normalized_xhs_user_id and (not isinstance(args_obj.get("id"), str) or not args_obj.get("id")):
                args_obj["id"] = normalized_xhs_user_id
        if intent_type in {"user", "user-posts", "user-comments"}:
            if normalized_username:
                args_obj["username"] = normalized_username
        if intent_type in {"thread", "article"}:
            if normalized_tweet_id and (not isinstance(args_obj.get("tweet_id"), str) or not args_obj.get("tweet_id")):
                args_obj["tweet_id"] = normalized_tweet_id
        if intent_type == "question":
            if normalized_question_id and (not isinstance(args_obj.get("id"), str) or not args_obj.get("id")):
                args_obj["id"] = normalized_question_id
        if intent_type in {"video", "comments"}:
            if normalized_bvid and (not isinstance(args_obj.get("bvid"), str) or not args_obj.get("bvid")):
                args_obj["bvid"] = normalized_bvid
        if intent_type in {"popular", "comments"}:
            page_arg = intent_args.get("page")
            if isinstance(page_arg, int) and page_arg > 0 and "page" not in args_obj:
                args_obj["page"] = page_arg
        if intent_type == "search":
            page_arg = intent_args.get("page")
            if isinstance(page_arg, int) and page_arg > 0 and "page" not in args_obj:
                args_obj["page"] = page_arg
        if intent_type == "search":
            order_arg = intent_args.get("order")
            if isinstance(order_arg, str) and order_arg.strip() and "order" not in args_obj:
                args_obj["order"] = order_arg.strip()
        if intent_type == "feed":
            type_arg = intent_args.get("type")
            if isinstance(type_arg, str) and type_arg.strip() and "type" not in args_obj:
                args_obj["type"] = type_arg.strip().lower()
        if intent_type == "ranking":
            category_arg = intent_args.get("category")
            if isinstance(category_arg, int) and "category" not in args_obj:
                args_obj["category"] = category_arg
        if intent_type == "comments":
            sort_arg = intent_args.get("sort")
            if isinstance(sort_arg, int) and "sort" not in args_obj:
                args_obj["sort"] = sort_arg
        if intent_type == "ranking":
            category_arg = intent_args.get("category")
            if isinstance(category_arg, int) and "category" not in args_obj:
                args_obj["category"] = category_arg
        if intent_type in {"video", "transcript"}:
            raw_url_arg = intent_args.get("url", intent_args.get("video_url", intent_args.get("video_id")))
            if isinstance(raw_url_arg, str) and raw_url_arg.strip() and "url" not in args_obj:
                args_obj["url"] = raw_url_arg.strip()
        if intent_type == "channel":
            channel_id_arg = intent_args.get("id", intent_args.get("channel_id"))
            if isinstance(channel_id_arg, str) and channel_id_arg.strip() and "id" not in args_obj:
                args_obj["id"] = channel_id_arg.strip()
        if intent_type == "transcript":
            lang_arg = intent_args.get("lang")
            if isinstance(lang_arg, str) and lang_arg.strip() and "lang" not in args_obj:
                args_obj["lang"] = lang_arg.strip()
            mode_arg = intent_args.get("mode")
            if isinstance(mode_arg, str) and mode_arg.strip() and "mode" not in args_obj:
                args_obj["mode"] = mode_arg.strip().lower()
        if intent_type in {"comments", "post", "user"}:
            weibo_id_arg = intent_args.get("id")
            if isinstance(weibo_id_arg, str) and weibo_id_arg.strip() and "id" not in args_obj:
                args_obj["id"] = weibo_id_arg.strip()
        if intent_type == "user_posts":
            weibo_uid_arg = intent_args.get("uid", intent_args.get("id"))
            if isinstance(weibo_uid_arg, str) and weibo_uid_arg.strip() and "uid" not in args_obj:
                args_obj["uid"] = weibo_uid_arg.strip()
            page_arg = intent_args.get("page")
            if isinstance(page_arg, int) and page_arg > 0 and "page" not in args_obj:
                args_obj["page"] = page_arg
            feature_arg = intent_args.get("feature")
            if isinstance(feature_arg, int) and feature_arg >= 0 and "feature" not in args_obj:
                args_obj["feature"] = feature_arg
        if intent_type == "comments":
            max_id_arg = intent_args.get("max_id", intent_args.get("maxId"))
            if isinstance(max_id_arg, str) and max_id_arg.strip() and "max_id" not in args_obj:
                args_obj["max_id"] = max_id_arg.strip()
        if intent_type == "hot":
            period_arg = intent_args.get("period")
            if isinstance(period_arg, str) and period_arg.strip() and "period" not in args_obj:
                args_obj["period"] = period_arg.strip().lower()
        if intent_type == "category":
            if isinstance(intent_args.get("slug"), str) and intent_args.get("slug").strip() and "slug" not in args_obj:
                args_obj["slug"] = intent_args.get("slug").strip()
            category_id = intent_args.get("id", intent_args.get("category_id"))
            if isinstance(category_id, int) and category_id > 0 and "id" not in args_obj:
                args_obj["id"] = category_id
        if intent_type == "topic":
            topic_id = intent_args.get("id", intent_args.get("topic_id"))
            if isinstance(topic_id, int) and topic_id > 0 and "id" not in args_obj:
                args_obj["id"] = topic_id
        if normalized_limit is not None and "count" not in args_obj:
            args_obj["count"] = str(normalized_limit)
        if normalized_limit is not None and "limit" not in args_obj:
            args_obj["limit"] = normalized_limit
        if isinstance(sort, str) and sort.strip():
            if not isinstance(args_obj.get("sort"), str) or not args_obj.get("sort"):
                args_obj["sort"] = sort.strip()
        if isinstance(time_filter, str) and time_filter.strip():
            if not isinstance(args_obj.get("time"), str) or not args_obj.get("time"):
                args_obj["time"] = time_filter.strip()
        if args_obj:
            merged_option["args"] = args_obj
        if driver_name == "playwright":
            has_script_body = isinstance(merged_option.get("scriptBody"), str) and merged_option.get("scriptBody", "").strip()
            has_script_path = isinstance(merged_option.get("scriptPath"), str) and merged_option.get("scriptPath", "").strip()
            current_mode = str(merged_option.get("mode", "")).strip().lower()
            if not has_script_body and not has_script_path and not current_mode:
                _intent_to_mode = [
                    ({"x", "twitter"}, X_INTERCEPT_INTENTS, "intercept-x-"),
                    ({"reddit"}, REDDIT_INTERCEPT_INTENTS, "intercept-reddit-"),
                    ({"xhs", "xiaohongshu"}, XHS_INTERCEPT_INTENTS, "intercept-xhs-"),
                    ({"bbc"}, BBC_INTERCEPT_INTENTS, "intercept-bbc-"),
                    ({"hackernews", "hn"}, HACKERNEWS_INTERCEPT_INTENTS, "intercept-hackernews-"),
                    ({"linkedin"}, LINKEDIN_INTERCEPT_INTENTS, "intercept-linkedin-"),
                    ({"linux-do", "linuxdo"}, LINUX_DO_INTERCEPT_INTENTS, "intercept-linux-do-"),
                    ({"youtube"}, YOUTUBE_INTERCEPT_INTENTS, "intercept-youtube-"),
                    ({"weibo"}, WEIBO_INTERCEPT_INTENTS, "intercept-weibo-"),
                    ({"zhihu"}, ZHIHU_INTERCEPT_INTENTS, "intercept-zhihu-"),
                    ({"bilibili"}, BILIBILI_INTERCEPT_INTENTS, "intercept-bilibili-"),
                    ({"36kr"}, KR36_INTERCEPT_INTENTS, "intercept-36kr-"),
                    ({"arxiv"}, ARXIV_INTERCEPT_INTENTS, "intercept-arxiv-"),
                    ({"baidu"}, BAIDU_INTERCEPT_INTENTS, "intercept-baidu-"),
                    ({"bing"}, BING_INTERCEPT_INTENTS, "intercept-bing-"),
                    ({"cnblogs"}, CNBLOGS_INTERCEPT_INTENTS, "intercept-cnblogs-"),
                    ({"csdn"}, CSDN_INTERCEPT_INTENTS, "intercept-csdn-"),
                    ({"ctrip"}, CTRIP_INTERCEPT_INTENTS, "intercept-ctrip-"),
                    ({"devto"}, DEVTO_INTERCEPT_INTENTS, "intercept-devto-"),
                    ({"duckduckgo"}, DUCKDUCKGO_INTERCEPT_INTENTS, "intercept-duckduckgo-"),
                    ({"google"}, GOOGLE_INTERCEPT_INTENTS, "intercept-google-"),
                    ({"reuters"}, REUTERS_INTERCEPT_INTENTS, "intercept-reuters-"),
                    ({"toutiao"}, TOUTIAO_INTERCEPT_INTENTS, "intercept-toutiao-"),
                    ({"hupu"}, HUPU_INTERCEPT_INTENTS, "intercept-hupu-"),
                ]
                matched = False
                for platform_set, intents, prefix in _intent_to_mode:
                    if normalized_platform in platform_set and intent_type in intents:
                        merged_option["mode"] = f"{prefix}{intent_type}"
                        matched = True
                        break
                if not matched and intent_type == "search":
                    merged_option["mode"] = "intercept-x-search"
        return merged_option

    if driver_name == "xhttp":
        if intent_type != "search":
            return merged_option
        params = merged_option.get("params")
        params_obj = dict(params) if isinstance(params, dict) else {}
        if normalized_query and (not isinstance(params_obj.get("q"), str) or not params_obj.get("q")):
            params_obj["q"] = normalized_query
        if normalized_limit is not None and "limit" not in params_obj:
            params_obj["limit"] = normalized_limit
        if params_obj:
            merged_option["params"] = params_obj
        return merged_option

    return merged_option

