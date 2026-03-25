/* @meta
{
  "name": "reddit/user",
  "description": "获取 reddit 的 user 数据",
  "domain": "reddit.com",
  "args": {
    "username": {
      "required": true,
      "description": "Script argument: username"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site reddit/user spez",
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
  const response = await fetch(`/user/${encodeURIComponent(username)}/about.json?raw_json=1`, {
    credentials: "include",
  });
  const payload = await response.json();
  const data = payload?.data || payload || {};
  const users = [
    {
      username: data.name || username,
      post_karma: data.link_karma ?? 0,
      comment_karma: data.comment_karma ?? 0,
      total_karma: data.total_karma ?? (data.link_karma || 0) + (data.comment_karma || 0),
      is_gold: Boolean(data.is_gold),
      verified: Boolean(data.verified),
      created_at: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : null,
      url: `https://www.reddit.com/user/${data.name || username}`,
    },
  ];

  return {
    username,
    users,
  };
};
