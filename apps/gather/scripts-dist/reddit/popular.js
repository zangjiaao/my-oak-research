// Sample /v3/fetch key parts
// intent.type: popular
// intent.args: {"limit":20}
// output.field: {"id":"posts.id","title":"posts.title","author":"posts.author","subreddit":"posts.subreddit","score":"posts.score","comments":"posts.comments","url":"posts.url"}
async () => {
    const limit = Number.isFinite(__LIMIT__) ? Math.max(1, __LIMIT__) : 20;
    const response = await fetch(`/r/popular.json?limit=${limit}&raw_json=1`, { credentials: "include" });
    const payload = await response.json();
    const posts = (payload?.data?.children || []).map((child) => {
        const data = child?.data || {};
        return {
            id: data.id || null,
            title: data.title || "",
            subreddit: data.subreddit_name_prefixed || "",
            author: data.author || "",
            score: data.score ?? 0,
            comments: data.num_comments ?? 0,
            url: data.permalink ? `https://www.reddit.com${data.permalink}` : "",
            created_at: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : null,
            text: data.selftext || "",
        };
    });
    return {
        count: posts.length,
        posts: posts.slice(0, limit),
    };
};
