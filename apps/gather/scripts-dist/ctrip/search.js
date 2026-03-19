// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"三亚"}
// output.field: {"source":"source","count":"count","results":"results"}
async () => {
    const query = String(__QUERY_JSON__ || "").trim();
    if (!query)
        return { error: "query is required" };
    try {
        const suggestUrl = `https://m.ctrip.com/restapi/h5api/searchapp/search?action=onekeyali&keyword=${encodeURIComponent(query)}`;
        const suggestResp = await fetch(suggestUrl, { credentials: "include" });
        if (suggestResp.ok) {
            const suggestData = await suggestResp.json();
            if (suggestData && (suggestData.data || suggestData.result)) {
                const raw = suggestData.data || suggestData.result || suggestData;
                return { query, source: "suggest_api", data: raw };
            }
        }
    }
    catch (_error) { }
    try {
        const guideUrl = `https://you.ctrip.com/SearchSite/Default/Destination?keyword=${encodeURIComponent(query)}`;
        const guideResp = await fetch(guideUrl, { credentials: "include" });
        if (guideResp.ok) {
            const html = await guideResp.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const items = Array.from(doc.querySelectorAll('[class*="result"], [class*="dest-item"], li, .list_mod_item'));
            const results = [];
            for (const item of items) {
                const linkEl = item.querySelector("a[href]");
                const nameEl = item.querySelector("h2, h3, [class*='name'], [class*='title']");
                if (!linkEl || !nameEl)
                    continue;
                results.push({
                    name: String(nameEl.textContent || "").trim(),
                    url: linkEl.getAttribute("href") || "",
                });
            }
            if (results.length > 0)
                return { query, source: "destination_search", count: results.length, results: results.slice(0, 15) };
        }
    }
    catch (_error) { }
    return {
        query,
        error: "No results found. Ctrip may require an active browser session on www.ctrip.com.",
        hint: "Open www.ctrip.com first, then retry.",
    };
};
