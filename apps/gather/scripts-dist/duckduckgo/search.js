// Sample /v1/fetch key parts
// intent.type: search
// intent.args: {"query":"openai"}
// output.field: {"title":"results.title","url":"results.url","snippet":"results.snippet"}
async () => {
    const query = String(__QUERY_JSON__ || "").trim();
    if (!query)
        return { error: "Missing argument: query", hint: "Provide a search query string" };
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(url);
    if (!response.ok)
        return { error: `HTTP ${response.status}` };
    const html = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const items = Array.from(doc.querySelectorAll(".result"));
    const results = items.map((item) => {
        const anchor = item.querySelector(".result__a");
        if (!anchor)
            return null;
        let href = anchor.getAttribute("href") || "";
        const udMatch = href.match(/[?&]uddg=([^&]+)/);
        if (udMatch)
            href = decodeURIComponent(udMatch[1]);
        return {
            title: String(anchor.textContent || "").trim(),
            url: href,
            snippet: String(item.querySelector(".result__snippet")?.textContent || "").trim(),
        };
    }).filter(Boolean);
    return { query, count: results.length, results };
};
