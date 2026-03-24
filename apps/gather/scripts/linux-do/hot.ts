// Sample /v1/fetch key parts
// intent.type: hot
// intent.args: {"period":"weekly","limit":20}
// output.field: {"rank":"topics.rank","title":"topics.title","replies":"topics.replies","views":"topics.views","likes":"topics.likes","category":"topics.category"}
// category: "INTERACTIVE"
// auth.required: false
// auth.kind: "linux-do-cookie"
// auth.description: "linux-do auth credential"
// tags: ["domestic"]

async () => {
  const period = String(__PERIOD_JSON__ || "weekly").trim() || "weekly";
  const response = await fetch(`/top.json?period=${encodeURIComponent(period)}`, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} - 请先登录 linux.do`);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error("响应不是有效 JSON - 请先登录 linux.do");
  }
  const topics = Array.isArray(data?.topic_list?.topics) ? data.topic_list.topics : [];
  const categories = Array.isArray(data?.topic_list?.categories)
    ? data.topic_list.categories
    : Array.isArray(data?.categories)
      ? data.categories
      : [];
  const categoryMap = Object.fromEntries(categories.map((item) => [item?.id, item?.name]));
  return {
    period,
    count: topics.length,
    topics: topics.slice(0, __COUNT__).map((topic, index) => ({
      rank: index + 1,
      title: topic?.title || "",
      replies: Math.max(0, (topic?.posts_count || 1) - 1),
      views: topic?.views || 0,
      likes: topic?.like_count || 0,
      category: categoryMap[topic?.category_id] || String(topic?.category_id || ""),
    })),
  };
};
