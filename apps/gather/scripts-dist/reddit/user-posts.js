// Sample /v3/fetch key parts
// intent.type: user-posts
// intent.args: {"username":"spez","limit":20}
// output.field: {"id":"posts.id","title":"posts.title","subreddit":"posts.subreddit","score":"posts.score","comments":"posts.comments","url":"posts.url"}
async () => {
    const rawUsername = (__USERNAME_JSON__ || "").trim();
    const username = rawUsername.replace(/^u\//i, "");
    const limit = Number.isFinite(__LIMIT__) ? Math.max(1, __LIMIT__) : 20;
    const response = await fetch(`/user/${encodeURIComponent(username)}/submitted.json?limit=${limit}&raw_json=1`, {
        credentials: "include",
    });
    const payload = await response.json();
    const posts = (payload?.data?.children || []).map((child) => {
        const data = child?.data || {};
        return {
            id: data.id || null,
            title: data.title || "",
            subreddit: data.subreddit_name_prefixed || "",
            score: data.score ?? 0,
            comments: data.num_comments ?? 0,
            url: data.permalink ? `https://www.reddit.com${data.permalink}` : "",
            created_at: data.created_utc ? new Date(data.created_utc * 1000).toISOString() : null,
            text: data.selftext || "",
        };
    });
    return {
        username,
        count: posts.length,
        posts: posts.slice(0, limit),
    };
};
