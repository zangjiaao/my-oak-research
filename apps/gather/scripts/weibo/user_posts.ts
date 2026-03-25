/* @meta
{
  "name": "weibo/user_posts",
  "description": "获取 weibo 的 user_posts 数据",
  "domain": "weibo.com",
  "args": {
    "uid": {
      "required": true,
      "description": "Script argument: uid"
    },
    "page": {
      "required": false,
      "description": "Script argument: page"
    },
    "feature": {
      "required": true,
      "description": "Script argument: feature"
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
  "example": "bb-browser site weibo/user_posts 1654184992 1"
}
*/

async () => {
  const uid = String(__WEIBO_UID_JSON__ || "").trim();
  if (!uid) throw new Error("Missing argument: uid");

  const page = Math.max(1, __PAGE__ || 1);
  const feature = Math.max(0, __FEATURE__ || 0);

  const response = await fetch(`/ajax/statuses/mymblog?uid=${encodeURIComponent(uid)}&page=${page}&feature=${feature}`, {
    credentials: "include",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (!data?.ok) throw new Error(`API error: ${data?.msg || "unknown"}`);

  const strip = (html) => String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  const posts = (data?.data?.list || []).slice(0, __COUNT__).map((status) => {
    const item = {
      id: status?.idstr || String(status?.id || ""),
      mblogid: status?.mblogid || "",
      text: status?.text_raw || strip(status?.text || ""),
      created_at: status?.created_at || "",
      source: strip(status?.source || ""),
      reposts_count: status?.reposts_count || 0,
      comments_count: status?.comments_count || 0,
      likes_count: status?.attitudes_count || 0,
      is_long_text: Boolean(status?.isLongText),
      pic_count: status?.pic_num || 0,
      url: `https://weibo.com/${uid}/${status?.mblogid || ""}`,
    } as any;

    if (status?.retweeted_status) {
      const rt = status.retweeted_status;
      item.retweeted = {
        id: rt?.idstr || String(rt?.id || ""),
        text: rt?.text_raw || strip(rt?.text || ""),
        user: rt?.user?.screen_name || "[deleted]",
      };
    }

    return item;
  });

  return {
    uid,
    page,
    feature,
    total: data?.data?.total || 0,
    count: posts.length,
    posts,
  };
};
