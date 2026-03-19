// Sample /v3/fetch key parts
// intent.type: top
// intent.args: {"limit":20}
// output.field: {"rank":"items.rank","title":"items.title","score":"items.score","author":"items.author","comments":"items.comments","url":"items.url"}
async () => {
    const limit = Math.max(1, Math.min(__LIMIT__, 100));
    const stories = [];
    try {
        const topResponse = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
        if (topResponse.ok) {
            const idsRaw = await topResponse.json();
            const ids = Array.isArray(idsRaw) ? idsRaw.slice(0, Math.max(limit, 30)) : [];
            for (const id of ids) {
                if (stories.length >= limit)
                    break;
                try {
                    const detailResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
                    if (!detailResponse.ok)
                        continue;
                    const item = await detailResponse.json();
                    if (!item || typeof item !== "object")
                        continue;
                    stories.push({
                        rank: stories.length + 1,
                        id: item.id || id,
                        title: item.title || "",
                        score: item.score || 0,
                        author: item.by || "",
                        comments: item.descendants || 0,
                        url: item.url || `https://news.ycombinator.com/item?id=${item.id || id}`,
                        created_at: item.time ? new Date(item.time * 1000).toISOString() : null,
                    });
                }
                catch (_error) { }
            }
        }
    }
    catch (_error) { }
    if (!stories.length) {
        const rows = Array.from(document.querySelectorAll("tr.athing"));
        for (const row of rows) {
            if (stories.length >= limit)
                break;
            const rankText = row.querySelector(".rank")?.textContent || "";
            const rank = Number.parseInt(rankText, 10) || stories.length + 1;
            const titleLink = row.querySelector(".titleline > a");
            const title = titleLink?.textContent?.trim() || "";
            if (!title)
                continue;
            const id = row.getAttribute("id") || "";
            const nextRow = row.nextElementSibling;
            const scoreText = nextRow?.querySelector(".score")?.textContent || "0";
            const score = Number.parseInt(scoreText, 10) || 0;
            const author = nextRow?.querySelector(".hnuser")?.textContent?.trim() || "";
            const commentsAnchor = Array.from(nextRow?.querySelectorAll("a") || []).find((item) => /comment/.test(item.textContent || ""));
            const comments = Number.parseInt(commentsAnchor?.textContent || "0", 10) || 0;
            stories.push({
                rank,
                id,
                title,
                score,
                author,
                comments,
                url: titleLink?.getAttribute("href") || `https://news.ycombinator.com/item?id=${id}`,
                created_at: null,
            });
        }
    }
    return {
        source: "hackernews.top",
        count: stories.length,
        items: stories.slice(0, __COUNT__),
    };
};
