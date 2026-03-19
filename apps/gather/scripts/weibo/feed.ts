// Sample /v3/fetch key parts
// intent.type: feed
// intent.args: {"limit":15}
// output.field: {"id":"statuses.id","text":"statuses.text","screen_name":"statuses.user.screen_name","url":"statuses.url","created_at":"statuses.created_at"}

async () => {
  const app = (document.querySelector("#app") as any)?.__vue_app__;
  const store = app?.config?.globalProperties?.$store;
  const cfg = store?.state?.config?.config;
  const uid = cfg?.uid;
  if (!uid) throw new Error("Not logged in");

  const listId = `10001${uid}`;
  const response = await fetch(`/ajax/feed/unreadfriendstimeline?list_id=${listId}&refresh=4&since_id=0&count=${__COUNT__}`, {
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

  const statuses = (data?.statuses || []).slice(0, __COUNT__).map((status) => {
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
      user: {
        id: status?.user?.id || null,
        screen_name: status?.user?.screen_name || "",
        verified: Boolean(status?.user?.verified),
      },
      url: `https://weibo.com/${status?.user?.id || ""}/${status?.mblogid || ""}`,
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

  return { count: statuses.length, statuses };
};
