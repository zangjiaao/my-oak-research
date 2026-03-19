// Sample /v3/fetch key parts
// intent.type: category
// intent.args: {"slug":"general","id":1,"limit":20}
// output.field: {"rank":"topics.rank","title":"topics.title","replies":"topics.replies","views":"topics.views","likes":"topics.likes"}
async () => {
    const slug = String(__SLUG_JSON__ || "").trim();
    const categoryId = __CATEGORY_ID__;
    if (!slug)
        throw new Error("slug is required");
    if (!categoryId || Number(categoryId) <= 0)
        throw new Error("id is required");
    const response = await fetch(`/c/${encodeURIComponent(slug)}/${encodeURIComponent(String(categoryId))}.json`, {
        credentials: "include",
    });
    if (!response.ok)
        throw new Error(`HTTP ${response.status} - 请先登录 linux.do`);
    let data;
    try {
        data = await response.json();
    }
    catch (_error) {
        throw new Error("响应不是有效 JSON - 请先登录 linux.do");
    }
    const topics = Array.isArray(data?.topic_list?.topics) ? data.topic_list.topics : [];
    return {
        slug,
        id: categoryId,
        count: topics.length,
        topics: topics.slice(0, __COUNT__).map((topic, index) => ({
            rank: index + 1,
            title: topic?.title || "",
            replies: Math.max(0, (topic?.posts_count || 1) - 1),
            views: topic?.views || 0,
            likes: topic?.like_count || 0,
        })),
    };
};
