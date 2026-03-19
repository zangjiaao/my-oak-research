from pathlib import Path
import sys

import pytest


sys.path.append(str(Path(__file__).resolve().parents[1]))

from script_framework import ScriptContext, ScriptRegistry, build_x_intent_script, build_x_search_intercept_script  # noqa: E402


def test_script_registry_resolve_x_search_intercept():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    spec = registry.resolve(ScriptContext(platform="x", intent="search", mode="intercept", args={}))
    assert spec is not None
    assert spec.key == "x.search.intercept"
    assert spec.source_path.exists()
    assert spec.runtime_path.exists()


def test_script_registry_auto_discovers_twitter_dir_as_x(tmp_path):
    source_root = tmp_path / "scripts"
    runtime_root = tmp_path / "scripts-dist"
    (source_root / "twitter").mkdir(parents=True, exist_ok=True)
    (runtime_root / "twitter").mkdir(parents=True, exist_ok=True)
    (source_root / "twitter" / "search.ts").write_text("async () => ({ ok: true })", encoding="utf-8")
    (runtime_root / "twitter" / "search.js").write_text("async () => ({ ok: true })", encoding="utf-8")

    registry = ScriptRegistry(source_root, runtime_root)
    spec = registry.resolve(ScriptContext(platform="x", intent="search", mode="intercept", args={}))
    assert spec is not None
    assert spec.key == "x.search.intercept"
    assert registry.intents_for("x") == {"search"}


def test_script_registry_auto_discovers_reddit_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("reddit")
    assert "search" in intents
    assert "subreddit" in intents
    assert "user-posts" in intents


def test_script_registry_auto_discovers_xhs_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("xhs")
    assert "search" in intents
    assert "user" in intents
    assert "feed" in intents


def test_script_registry_auto_discovers_bbc_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("bbc")
    assert "news" in intents


def test_script_registry_auto_discovers_hackernews_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("hackernews")
    assert "top" in intents


def test_script_registry_auto_discovers_linkedin_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("linkedin")
    assert "search" in intents


def test_script_registry_auto_discovers_linux_do_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("linux-do")
    assert "search" in intents
    assert "latest" in intents
    assert "hot" in intents
    assert "categories" in intents
    assert "category" in intents
    assert "topic" in intents


def test_script_registry_auto_discovers_youtube_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("youtube")
    assert "search" in intents
    assert "video" in intents
    assert "transcript" in intents
    assert "channel" in intents


def test_script_registry_auto_discovers_weibo_intents():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    intents = registry.intents_for("weibo")
    assert "feed" in intents
    assert "hot" in intents
    assert "me" in intents
    assert "post" in intents
    assert "comments" in intents
    assert "user" in intents
    assert "user_posts" in intents


def test_build_x_search_intercept_script_renders_placeholders():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_search_intercept_script(
        registry=registry,
        query="openai",
        search_type="latest",
        count=20,
        scroll_times=3,
    )
    assert "__QUERY_JSON__" not in script
    assert "__PRODUCT_JSON__" not in script
    assert "__COUNT__" not in script
    assert "__SCROLL_TIMES__" not in script
    assert '"openai"' in script
    assert '"Latest"' in script


@pytest.mark.parametrize(
    "intent",
    ["profile", "timeline", "bookmarks", "notifications", "followers", "following", "thread", "article"],
)
def test_build_x_intent_script_resolves_all_registered_intents(intent):
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        intent_type=intent,
        replacements={
            "__QUERY_JSON__": '"openai"',
            "__USERNAME_JSON__": '"openai"',
            "__TWEET_ID_JSON__": '"1900000000000000000"',
            "__COUNT__": 20,
            "__SCROLL_TIMES__": 3,
        },
    )
    assert "async () => {" in script


def test_build_reddit_search_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="reddit",
        intent_type="search",
        replacements={
            "__QUERY_JSON__": '"openai"',
            "__SUBREDDIT_JSON__": '""',
            "__SORT_JSON__": '"relevance"',
            "__TIME_JSON__": '"all"',
            "__LIMIT__": 20,
            "__COUNT__": 20,
        },
    )
    assert "__QUERY_JSON__" not in script
    assert "__LIMIT__" not in script
    assert "search.json" in script


def test_build_bbc_news_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="bbc",
        intent_type="news",
        replacements={
            "__LIMIT__": 20,
            "__COUNT__": 20,
        },
    )
    assert "__LIMIT__" not in script
    assert "__COUNT__" not in script
    assert "feeds.bbci.co.uk/news/rss.xml" in script


def test_build_hackernews_top_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="hackernews",
        intent_type="top",
        replacements={
            "__LIMIT__": 20,
            "__COUNT__": 20,
        },
    )
    assert "__LIMIT__" not in script
    assert "__COUNT__" not in script
    assert "topstories.json" in script


def test_build_linkedin_search_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="linkedin",
        intent_type="search",
        replacements={
            "__QUERY_JSON__": '"software engineer"',
            "__LOCATION_JSON__": '"San Francisco"',
            "__COMPANY_JSON__": '""',
            "__EXPERIENCE_LEVEL_JSON__": '""',
            "__JOB_TYPE_JSON__": '""',
            "__DATE_POSTED_JSON__": '""',
            "__REMOTE_JSON__": '""',
            "__START__": 0,
            "__LIMIT__": 10,
            "__COUNT__": 10,
            "__DETAILS__": "false",
        },
    )
    assert "__QUERY_JSON__" not in script
    assert "__LOCATION_JSON__" not in script
    assert "__LIMIT__" not in script
    assert "__COUNT__" not in script
    assert "voyagerJobsDashJobCards" in script


def test_build_linux_do_search_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="linux-do",
        intent_type="search",
        replacements={
            "__KEYWORD_JSON__": '"playwright"',
            "__SLUG_JSON__": '""',
            "__PERIOD_JSON__": '"weekly"',
            "__CATEGORY_ID__": 0,
            "__TOPIC_ID__": 0,
            "__LIMIT__": 20,
            "__COUNT__": 20,
        },
    )
    assert "__KEYWORD_JSON__" not in script
    assert "__LIMIT__" not in script
    assert "__COUNT__" not in script
    assert "/search.json" in script


def test_build_youtube_search_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="youtube",
        intent_type="search",
        replacements={
            "__QUERY_JSON__": '"openai"',
            "__URL_JSON__": '""',
            "__CHANNEL_ID_JSON__": '""',
            "__LANG_JSON__": '""',
            "__MODE_JSON__": '"grouped"',
            "__LIMIT__": 20,
            "__COUNT__": 20,
        },
    )
    assert "__QUERY_JSON__" not in script
    assert "__COUNT__" not in script
    assert "youtubei/v1/search" in script


def test_build_youtube_channel_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="youtube",
        intent_type="channel",
        replacements={
            "__QUERY_JSON__": '""',
            "__URL_JSON__": '""',
            "__CHANNEL_ID_JSON__": '"@openai"',
            "__LANG_JSON__": '""',
            "__MODE_JSON__": '"grouped"',
            "__LIMIT__": 10,
            "__COUNT__": 10,
        },
    )
    assert "__CHANNEL_ID_JSON__" not in script
    assert "__COUNT__" not in script
    assert "youtubei/v1/browse" in script


def test_build_weibo_feed_script():
    app_root = Path(__file__).resolve().parents[1]
    registry = ScriptRegistry(app_root / "scripts", app_root / "scripts-dist")
    script = build_x_intent_script(
        registry=registry,
        platform="weibo",
        intent_type="feed",
        replacements={
            "__WEIBO_ID_JSON__": '""',
            "__WEIBO_UID_JSON__": '""',
            "__MAX_ID_JSON__": '""',
            "__PAGE__": 1,
            "__FEATURE__": 0,
            "__LIMIT__": 20,
            "__COUNT__": 20,
        },
    )
    assert "__COUNT__" not in script
    assert "unreadfriendstimeline" in script
