// Sample /v1/fetch key parts
// intent.type: hot
// intent.args: {"limit":20}
// output.field: {"rank":"items.rank","title":"items.title","heat":"items.heat","url":"items.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "zhihu-cookie"
// auth.description: "zhihu auth credential"
// tags: ["domestic"]

async () => {
  const count = Math.max(1, Math.min(__COUNT__, 50));
  const response = await fetch("https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50", {
    credentials: "include",
  });
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  }

  const payload = await response.json();
  const items = (payload?.data || []).slice(0, count).map((entry, index) => {
    const target = entry?.target || {};
    return {
      rank: index + 1,
      id: target?.id || "",
      title: target?.title || "",
      url: target?.id ? `https://www.zhihu.com/question/${target.id}` : "https://www.zhihu.com/hot",
      excerpt: target?.excerpt || "",
      answer_count: target?.answer_count || 0,
      follower_count: target?.follower_count || 0,
      heat: entry?.detail_text || "",
      trend: entry?.trend === 0 ? "stable" : entry?.trend > 0 ? "up" : "down",
      is_new: Boolean(entry?.debut),
    };
  });

  return { count: items.length, items };
};
