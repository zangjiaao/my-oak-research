/* @meta
{
  "name": "reddit/user-posts",
  "description": "获取 reddit 的 user-posts 数据",
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
  "example": "bb-browser site reddit/user-posts spez 20"
}
*/

async () => {
  const rawUsername = (__USERNAME_JSON__ || "").trim();
  const username = rawUsername.replace(/^u\//i, "");
  const limit = Number.isFinite(__LIMIT__) ? Math.max(1, __LIMIT__) : 20;
  const response = await fetch(`/user/${encodeURIComponent(username)}/submitted.json?limit=${limit}&raw_json=1`, {
    credentials: "include",
  });
  const payload = await response.json();
  const posts = (payload?.data?.children || []).map((child) => {
    const data = child?.data || {};
    return {
      id: data.id || null,
      title: data.title || "",
      subreddit: data.subreddit_name_prefixed || "",
      score: data.score ?? 0,
      comments: data.num_comments ?? 0,
      url: data.permalink ? `https://www.reddit.com${data.permalink}` : "",
      created_at: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : null,
      text: data.selftext || "",
    };
  });

  return {
    username,
    count: posts.length,
    posts: posts.slice(0, limit),
  };
};
