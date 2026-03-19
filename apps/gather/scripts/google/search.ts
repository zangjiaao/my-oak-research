// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"openai","limit":10}
// output.field: {"title":"results.title","url":"results.url","snippet":"results.snippet"}

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "Missing argument: query", hint: "Provide a search query string" };
  const count = Math.max(1, Math.min(__COUNT__, 50));

  const parseDoc = (doc: Document) => {
    const items = Array.from(doc.querySelectorAll("div.g"));
    const results = [];
    for (const item of items) {
      const anchor = item.querySelector("a[href]");
      const heading = item.querySelector("h3");
      if (!anchor || !heading) continue;
      const link = anchor.getAttribute("href") || "";
      if (!link || link.startsWith("/search")) continue;

      let snippet = "";
      for (const span of Array.from(item.querySelectorAll("span"))) {
        const text = String(span.textContent || "").trim();
        if (text.length > 40 && text !== String(heading.textContent || "").trim()) {
          snippet = text;
          break;
        }
      }
      if (!snippet) {
        const cloned = item.cloneNode(true) as HTMLElement;
        const h = cloned.querySelector("h3");
        if (h) h.remove();
        const a = cloned.querySelector("a");
        if (a) a.remove();
        snippet = String(cloned.textContent || "").trim().slice(0, 300);
      }

      results.push({ title: String(heading.textContent || "").trim(), url: link, snippet });
      if (results.length >= count) break;
    }
    return results;
  };

  let results = parseDoc(document);
  if (results.length === 0) {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${count}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        return { query, count: 0, results: [], hint: `google fetch status ${response.status}` };
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      results = parseDoc(doc);
    } catch (_error) {
      return { query, count: 0, results: [], hint: "google fetch failed in page context" };
    }
  }

  return { query, count: results.length, results };
};
