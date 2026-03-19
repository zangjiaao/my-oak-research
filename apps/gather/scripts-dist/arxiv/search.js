// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"large language model","limit":10}
// output.field: {"id":"papers.id","title":"papers.title","authors":"papers.authors","url":"papers.url"}
async () => {
    const query = String(__QUERY_JSON__ || "").trim();
    if (!query)
        return { error: "query is required" };
    const count = Math.max(1, Math.min(__COUNT__, 50));
    const parseDoc = (doc) => {
        const papers = Array.from(doc.querySelectorAll("li.arxiv-result")).slice(0, count).map((item) => {
            const title = String(item.querySelector("p.title")?.textContent || "").replace(/\s+/g, " ").trim();
            const abstract = String(item.querySelector("span.abstract-full")?.textContent || "")
                .replace(/^Abstract:\s*/i, "")
                .replace(/\s+/g, " ")
                .trim()
                .slice(0, 500);
            const authors = Array.from(item.querySelectorAll("p.authors a")).map((a) => String(a.textContent || "").trim()).filter(Boolean);
            const absUrl = item.querySelector("p.list-title a")?.getAttribute("href") || "";
            const pdfUrl = item.querySelector('a[title="Download PDF"]')?.getAttribute("href") || "";
            const publishedLine = String(item.querySelector("p.is-size-7")?.textContent || "");
            const publishedMatch = publishedLine.match(/Submitted\s+(\d+\s+\w+\s+\d{4})/i);
            const categories = String(item.querySelector("span.tag.is-small")?.textContent || "")
                .split(";")
                .map((v) => v.trim())
                .filter(Boolean);
            const idMatch = absUrl.match(/\/abs\/([^/?#]+)/);
            return {
                id: idMatch ? idMatch[1] : "",
                title,
                abstract,
                authors,
                published: publishedMatch ? publishedMatch[1] : "",
                categories,
                url: absUrl,
                pdf: pdfUrl,
            };
        });
        const totalText = String(doc.querySelector("h1.title")?.textContent || "");
        const totalMatch = totalText.match(/of\s+([\d,]+)\s+results/i);
        const totalResults = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) || 0 : papers.length;
        return { papers, totalResults };
    };
    let parsed = parseDoc(document);
    if (parsed.papers.length === 0) {
        const url = `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all&source=header&size=${count}`;
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok)
            return { error: `HTTP ${response.status}` };
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        parsed = parseDoc(doc);
    }
    const { papers, totalResults } = parsed;
    return { query, totalResults, count: papers.length, papers };
};
