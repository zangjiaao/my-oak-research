// Sample /v3/fetch key parts
// intent.type: feed
// intent.args: {"type":"all","limit":20}
// output.field: {"id":"items.id","author":"items.author","text":"items.text","url":"items.url"}

async () => {
  const type = String(__TYPE_JSON__ || "all");
  const count = Math.max(1, Math.min(__COUNT__, 100));
  const response = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=${encodeURIComponent(type)}&page=1`, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };
  if (!Array.isArray(payload?.data?.items) || payload.data.items.length === 0) {
    return { error: "No feed items", hint: "Not logged in or not following anyone?" };
  }

  const items = payload.data.items.slice(0, count).map((item) => {
    const author = item?.modules?.module_author;
    const dynamic = item?.modules?.module_dynamic;
    const stat = item?.modules?.module_stat;
    const base: any = {
      id: item?.id_str || "",
      type: item?.type || "",
      url: item?.id_str ? `https://www.bilibili.com/opus/${item.id_str}` : "https://www.bilibili.com",
      author: author?.name || "",
      author_mid: author?.mid || null,
      author_face: author?.face || "",
      pub_time: author?.pub_ts ? new Date(author.pub_ts * 1000).toISOString() : null,
      pub_action: author?.pub_action || "",
      text: dynamic?.desc?.text || null,
      comment_count: stat?.comment?.count || 0,
      forward_count: stat?.forward?.count || 0,
      like_count: stat?.like?.count || 0,
    };

    if (item?.type === "DYNAMIC_TYPE_AV" && dynamic?.major?.archive) {
      const archive = dynamic.major.archive;
      base.video = {
        bvid: archive?.bvid || "",
        title: archive?.title || "",
        cover: archive?.cover || "",
        duration_text: archive?.duration_text || "",
        play: archive?.stat?.play || 0,
        danmaku: archive?.stat?.danmaku || 0,
        url: archive?.bvid ? `https://www.bilibili.com/video/${archive.bvid}` : "",
      };
    }

    if (item?.type === "DYNAMIC_TYPE_DRAW" && dynamic?.major?.draw) {
      base.images = (dynamic.major.draw.items || []).map((image) => image?.src).filter(Boolean);
    }

    if (item?.type === "DYNAMIC_TYPE_ARTICLE" && dynamic?.major?.article) {
      const article = dynamic.major.article;
      base.article = {
        id: article?.id || null,
        title: article?.title || "",
        covers: article?.covers || [],
        url: article?.id ? `https://www.bilibili.com/read/cv${article.id}` : "",
      };
    }

    return base;
  });

  return { type, count: items.length, has_more: Boolean(payload?.data?.has_more), items };
};
