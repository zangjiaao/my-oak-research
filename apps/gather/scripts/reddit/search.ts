// Sample /v1/fetch key parts
// intent.type: search
// intent.args: {"query":"openai","subreddit":"","sort":"relevance","time":"all","limit":20}
// output.field: {"id":"posts.id","title":"posts.title","subreddit":"posts.subreddit","author":"posts.author","score":"posts.score","comments":"posts.comments","url":"posts.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "reddit-cookie"
// auth.description: "reddit auth credential"
// tags: ["foreign"]

async () => {
  const q = encodeURIComponent(__QUERY_JSON__ || "");
  const sub = (__SUBREDDIT_JSON__ || "").trim();
  const sort = (__SORT_JSON__ || "relevance").trim() || "relevance";
  const time = (__TIME_JSON__ || "all").trim() || "all";
  const limit = Number.isFinite(__LIMIT__) ? Math.max(1, __LIMIT__) : 20;
  const basePath = sub ? `/r/${sub.replace(/^r\//i, "")}/search.json` : "/search.json";
  const params = `q=${q}&sort=${encodeURIComponent(sort)}&t=${encodeURIComponent(time)}&limit=${limit}&restrict_sr=${sub ? "on" : "off"}&raw_json=1`;
  const response = await fetch(`${basePath}?${params}`, { credentials: "include" });
  const payload = await response.json();
  const posts = (payload?.data?.children || []).map((child) => {
    const data = child?.data || {};
    return {
      id: data.id || null,
      title: data.title || "",
      subreddit: data.subreddit_name_prefixed || "",
      author: data.author || "",
      score: data.score ?? 0,
      comments: data.num_comments ?? 0,
      url: data.permalink ? `https://www.reddit.com${data.permalink}` : "",
      created_at: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : null,
      text: data.selftext || "",
    };
  });

  return {
    query: __QUERY_JSON__,
    subreddit: __SUBREDDIT_JSON__,
    sort,
    time,
    count: posts.length,
    posts: posts.slice(0, limit),
  };
};
