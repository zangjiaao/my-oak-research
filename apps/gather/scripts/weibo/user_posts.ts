// Sample /v3/fetch key parts
// intent.type: user_posts
// intent.args: {"uid":"1654184992","page":1,"feature":0,"limit":20}
// output.field: {"id":"posts.id","text":"posts.text","url":"posts.url","created_at":"posts.created_at"}

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
