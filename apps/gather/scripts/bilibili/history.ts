// Sample /v3/fetch key parts
// intent.type: history
// intent.args: {"limit":20}
// output.field: {"bvid":"items.bvid","title":"items.title","progress":"items.progress","url":"items.url"}

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
