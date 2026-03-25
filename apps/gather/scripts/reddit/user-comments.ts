// Sample /v1/fetch key parts
// intent.type: user-comments
// intent.args: {"username":"spez","limit":20}
// output.field: {"id":"posts.id","subreddit":"posts.subreddit","score":"posts.score","body":"posts.body","url":"posts.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "reddit-cookie"
// auth.description: "reddit auth credential"
// tags: ["foreign"]

async () => {
  const rawUsername = (__USERNAME_JSON__ || "").trim();
  const username = rawUsername.replace(/^u\//i, "");
  const limit = Number.isFinite(__LIMIT__) ? Math.max(1, __LIMIT__) : 20;
  const response = await fetch(`/user/${encodeURIComponent(username)}/comments.json?limit=${limit}&raw_json=1`, {
    credentials: "include",
  });
  const payload = await response.json();
  const posts = (payload?.data?.children || []).map((child) => {
    const data = child?.data || {};
    const body = typeof data.body === "string" ? data.body : "";
    return {
      id: data.id || null,
      subreddit: data.subreddit_name_prefixed || "",
      score: data.score ?? 0,
      body: body.length > 300 ? `${body.slice(0, 300)}...` : body,
      url: data.permalink ? `https://www.reddit.com${data.permalink}` : "",
      created_at: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : null,
      text: body,
    };
  });

  return {
    username,
    count: posts.length,
    posts: posts.slice(0, limit),
  };
};
