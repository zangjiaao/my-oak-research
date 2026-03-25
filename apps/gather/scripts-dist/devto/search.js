// Sample /v1/fetch key parts
// intent.type: search
// intent.args: {"query":"rust programming","limit":10}
// output.field: {"title":"articles.title","url":"articles.url","author":"articles.author","published_at":"articles.published_at"}
async () => {
    const query = String(__QUERY_JSON__ || "").trim();
    if (!query)
        return { error: "query is required" };
    const count = Math.max(1, Math.min(__COUNT__, 100));
    const normalizeUrl = (href) => {
        const raw = String(href || "").trim();
        if (!raw)
            return "";
        if (raw.startsWith("http://") || raw.startsWith("https://"))
            return raw;
        if (raw.startsWith("/"))
            return `https://dev.to${raw}`;
        return "";
    };
    const parseFromDocument = () => {
        const cards = Array.from(document.querySelectorAll(".crayons-story, article.crayons-story"));
        const seen = new Set();
        const items = [];
        for (const card of cards) {
            if (card.closest("template"))
                continue;
            const titleAnchor = card.querySelector("h2 a, h3 a, a.crayons-story__hidden-navigation-link, .crayons-story__title a");
            if (!titleAnchor)
                continue;
            const title = String(titleAnchor.textContent || "").replace(/\s+/g, " ").trim();
            if (!title || title.toLowerCase() === "loading posts...")
                continue;
            const url = normalizeUrl(titleAnchor.getAttribute("href"));
            if (!url || seen.has(url))
                continue;
            seen.add(url);
            const authorAnchor = card.querySelector("a.crayons-story__secondary, .crayons-story__meta a[href^='/']");
            const author = String(authorAnchor?.textContent || "").trim().replace(/^@/, "");
            const snippet = String(card.querySelector(".crayons-story__body p, .crayons-story__snippet")?.textContent || "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 300);
            const publishedAtRaw = String(card.querySelector("time")?.getAttribute("datetime") || "");
            const publishedAt = publishedAtRaw || null;
            const tags = Array.from(card.querySelectorAll(".crayons-tag")).map((tag) => String(tag.textContent || "").trim()).filter(Boolean);
            items.push({
                title,
                url,
                description: snippet,
                author: author || null,
                username: author || null,
                published_at: publishedAt,
                reactions: 0,
                comments: 0,
                tags,
                reading_time: null,
            });
            if (items.length >= count)
                break;
        }
        return items;
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let articles = parseFromDocument();
    for (let i = 0; articles.length === 0 && i < 12; i += 1) {
        await sleep(500);
        articles = parseFromDocument();
    }
    if (articles.length === 0) {
        try {
            const url = `https://dev.to/search/feed_content?per_page=${count}&page=0&search_fields=${encodeURIComponent(query)}&class_name=Article`;
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                const fallback = data?.result || [];
                articles = fallback.map((article) => ({
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
                }));
            }
        }
        catch (_error) { }
    }
    return {
        query,
        count: articles.length,
        articles,
    };
};
