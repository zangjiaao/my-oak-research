/* @meta
{
  "name": "reddit/user-comments",
  "description": "获取 reddit 的 user-comments 数据",
  "domain": "reddit.com",
  "args": {
    "username": {
      "required": true,
      "description": "Script argument: username"
    },
    "limit": {
      "required": false,
      "description": "Script argument: limit"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site reddit/user-comments spez 20",
  "category": "INTERACTIVE",
  "auth": {
    "required": true,
    "kind": "reddit-cookie",
    "description": "reddit auth credential"
  },
  "tags": [
    "foreign"
  ]
}
*/

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
