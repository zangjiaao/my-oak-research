// Sample /v3/fetch key parts
// intent.type: newsflash
// intent.args: {"limit":20}
// output.field: {"title":"items.title","description":"items.description","timestamp":"items.timestamp","url":"items.url"}
async () => {
    const count = Math.max(1, Math.min(__COUNT__, 50));
    const response = await fetch("https://gateway.36kr.com/api/mis/nav/newsflash/flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
            partner_id: "web",
            param: { siteId: 1, platformId: 2, pageSize: count, pageEvent: 0 },
            timestamp: Date.now(),
        }),
    });
    if (!response.ok) {
        const pageResponse = await fetch("https://36kr.com/newsflashes", { credentials: "include" });
        if (!pageResponse.ok)
            return { error: `HTTP ${pageResponse.status}`, hint: "Navigate to 36kr.com first" };
        const html = await pageResponse.text();
        const match = html.match(/window\.initialState\s*=\s*(\{.*?\});?\s*<\/script/s);
        if (!match)
            return { error: "Failed to parse page data" };
        try {
            const state = JSON.parse(match[1]);
            const list = state?.newsflashCatalogData?.data?.newsflashList?.data?.itemList || state?.newsflashCatalogData?.newsflashList?.itemList || [];
            const items = list.slice(0, count).map((item, index) => {
                const material = item?.templateMaterial || {};
                return {
                    rank: index + 1,
                    id: String(item?.itemId || ""),
                    title: material?.widgetTitle || "",
                    description: String(material?.widgetContent || "").slice(0, 500),
                    timestamp: material?.publishTime ? new Date(material.publishTime).toISOString() : null,
                    url: item?.itemId ? `https://36kr.com/newsflashes/${item.itemId}` : "",
                };
            });
            return { count: items.length, items, source: "ssr_fallback" };
        }
        catch (error) {
            return { error: `JSON parse failed: ${String(error)}` };
        }
    }
    const payload = await response.json();
    if (payload?.code !== 0)
        return { error: `API error: ${payload?.msg || payload?.code || "unknown"}` };
    const list = payload?.data?.itemList || [];
    const items = list.slice(0, count).map((item, index) => {
        const material = item?.templateMaterial || {};
        return {
            rank: index + 1,
            id: String(item?.itemId || ""),
            title: material?.widgetTitle || "",
            description: String(material?.widgetContent || "").slice(0, 500),
            timestamp: material?.publishTime ? new Date(material.publishTime).toISOString() : null,
            url: item?.itemId ? `https://36kr.com/newsflashes/${item.itemId}` : "",
        };
    });
    return { count: items.length, items };
};
