/* @meta
{
  "name": "reddit/subreddit",
  "description": "获取 reddit 的 subreddit 数据",
  "domain": "reddit.com",
  "args": {
    "name": {
      "required": true,
      "description": "Script argument: name"
    },
    "sort": {
      "required": true,
      "description": "Script argument: sort"
    },
    "time": {
      "required": true,
      "description": "Script argument: time"
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
  "example": "bb-browser site reddit/subreddit programming hot",
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
  const rawName = ((__SUBREDDIT_JSON__ || "") || "").trim();
  const subreddit = rawName.replace(/^r\//i, "");
  const sort = (__SORT_JSON__ || "hot").trim() || "hot";
  const time = (__TIME_JSON__ || "all").trim() || "all";
  const limit = Number.isFinite(__LIMIT__) ? Math.max(1, __LIMIT__) : 20;

  let path = `/r/${subreddit}/${sort}.json?limit=${limit}&raw_json=1`;
  if ((sort === "top" || sort === "controversial") && time) {
    path += `&t=${encodeURIComponent(time)}`;
  }

  const response = await fetch(path, { credentials: "include" });
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
    subreddit,
    sort,
    time,
    count: posts.length,
    posts: posts.slice(0, limit),
  };
};
