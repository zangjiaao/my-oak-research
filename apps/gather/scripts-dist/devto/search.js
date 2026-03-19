// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"rust programming","limit":10}
// output.field: {"title":"articles.title","url":"articles.url","author":"articles.author","published_at":"articles.published_at"}
async () => {
    const query = String(__QUERY_JSON__ || "").trim();
    if (!query)
        return { error: "query is required" };
    const count = Math.max(1, Math.min(__COUNT__, 100));
    const url = `https://dev.to/search/feed_content?per_page=${count}&page=0&search_fields=${encodeURIComponent(query)}&class_name=Article`;
    const response = await fetch(url);
    if (!response.ok)
        return { error: `HTTP ${response.status}` };
    const data = await response.json();
    const articles = data?.result || [];
    return {
        query,
        count: articles.length,
        articles: articles.map((article) => ({
            title: article?.title || "",
            url: article?.path ? `https://dev.to${article.path}` : null,
            description: `${article?.cloudinary_video_url ? "[video] " : ""}${String(article?.body_text || "").slice(0, 300)}`,
            author: article?.user?.name || null,
            username: article?.user?.username || null,
            published_at: article?.published_at_int ? new Date(article.published_at_int * 1000).toISOString() : null,
            reactions: article?.public_reactions_count || 0,
            comments: article?.comments_count || 0,
            tags: article?.tag_list || [],
            reading_time: article?.reading_time || null,
        })),
    };
};
