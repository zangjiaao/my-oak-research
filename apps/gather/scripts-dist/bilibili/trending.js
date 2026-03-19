// Sample /v3/fetch key parts
// intent.type: trending
// intent.args: {"limit":20}
// output.field: {"rank":"items.rank","keyword":"items.keyword","search_url":"items.search_url"}
async () => {
    const count = Math.max(1, Math.min(__COUNT__, 50));
    const response = await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/square?limit=${count}`, { credentials: "include" });
    if (!response.ok)
        return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
    const payload = await response.json();
    if (payload?.code !== 0)
        return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };
    const items = (payload?.data?.trending?.list || []).slice(0, count).map((item, index) => ({
        rank: index + 1,
        keyword: item?.keyword || "",
        show_name: item?.show_name || "",
        is_hot: Boolean(item?.icon),
        icon: item?.icon || null,
        search_url: item?.keyword ? `https://search.bilibili.com/all?keyword=${encodeURIComponent(item.keyword)}` : "",
    }));
    return { count: items.length, items };
};
