/* @meta
{
  "name": "bilibili/history",
  "description": "获取 bilibili 的 history 数据",
  "domain": "bilibili.com",
  "args": {
    "limit": {
      "required": false,
      "description": "Script argument: limit"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site bilibili/history 20",
  "category": "INTERACTIVE",
  "auth": {
    "required": true,
    "kind": "bilibili-cookie",
    "description": "bilibili auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const count = Math.max(1, Math.min(__COUNT__, 50));
  const response = await fetch(`https://api.bilibili.com/x/web-interface/history/cursor?ps=${count}&type=archive`, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };
  if (!Array.isArray(payload?.data?.list)) return { error: "No history data", hint: "Not logged in?" };

  const items = payload.data.list.map((item) => {
    const progress = item?.progress === -1
      ? "completed"
      : item?.progress > 0
        ? `${Math.floor(item.progress / 60)}:${String(item.progress % 60).padStart(2, "0")}`
        : "not_started";
    return {
      bvid: item?.history?.bvid || "",
      title: item?.title || "",
      author: item?.author_name || "",
      author_mid: item?.author_mid || null,
      cover: item?.cover || "",
      duration: item?.duration || 0,
      duration_text: item?.duration ? `${Math.floor(item.duration / 60)}:${String(item.duration % 60).padStart(2, "0")}` : null,
      progress,
      progress_seconds: item?.progress || 0,
      view_at: item?.view_at ? new Date(item.view_at * 1000).toISOString() : null,
      tag_name: item?.tag_name || "",
      url: item?.history?.bvid ? `https://www.bilibili.com/video/${item.history.bvid}` : null,
    };
  });

  return { count: items.length, items };
};
