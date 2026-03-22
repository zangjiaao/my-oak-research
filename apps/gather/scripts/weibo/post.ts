// Sample /v3/fetch key parts
// intent.type: post
// intent.args: {"id":"QvqcCrCyL"}
// output.field: {"id":"id","text":"text","screen_name":"user.screen_name","comments_count":"comments_count","url":"url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "weibo-cookie"
// auth.description: "weibo auth credential"
// tags: ["domestic"]

async () => {
  const postId = String(__WEIBO_ID_JSON__ || "").trim();
  if (!postId) throw new Error("Missing argument: id");

  const response = await fetch(`/ajax/statuses/show?id=${encodeURIComponent(postId)}`, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const status = await response.json();
  if (!status?.ok && !status?.idstr) throw new Error("Post not found");

  const strip = (html) => String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  let fullText = status?.text_raw || strip(status?.text || "");
  if (status?.isLongText) {
    const longResp = await fetch(`/ajax/statuses/longtext?id=${status?.idstr || ""}`, { credentials: "include" });
    if (longResp.ok) {
      const longData = await longResp.json();
      if (longData?.data?.longTextContent) {
        fullText = strip(longData.data.longTextContent);
      }
    }
  }

  const item: any = {
    id: status?.idstr || String(status?.id || ""),
    mblogid: status?.mblogid || "",
    text: fullText,
    created_at: status?.created_at || "",
    source: strip(status?.source || ""),
    reposts_count: status?.reposts_count || 0,
    comments_count: status?.comments_count || 0,
    likes_count: status?.attitudes_count || 0,
    is_long_text: Boolean(status?.isLongText),
    pic_count: status?.pic_num || 0,
    user: {
      id: status?.user?.id || null,
      screen_name: status?.user?.screen_name || "",
      verified: Boolean(status?.user?.verified),
      verified_reason: status?.user?.verified_reason || "",
      followers_count: status?.user?.followers_count || 0,
    },
    url: `https://weibo.com/${status?.user?.id || ""}/${status?.mblogid || ""}`,
  };

  if (status?.retweeted_status) {
    const rt = status.retweeted_status;
    item.retweeted = {
      id: rt?.idstr || String(rt?.id || ""),
      mblogid: rt?.mblogid || "",
      text: rt?.text_raw || strip(rt?.text || ""),
      user: {
        id: rt?.user?.id || null,
        screen_name: rt?.user?.screen_name || "[deleted]",
      },
      reposts_count: rt?.reposts_count || 0,
      comments_count: rt?.comments_count || 0,
      likes_count: rt?.attitudes_count || 0,
      url: `https://weibo.com/${rt?.user?.id || ""}/${rt?.mblogid || ""}`,
    };
  }

  return item;
};
