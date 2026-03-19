// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"openai","limit":10}
// output.field: {"title":"results.title","url":"results.url","snippet":"results.snippet"}

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "Missing argument: query", hint: "Provide a search query string" };
  const count = Math.max(1, Math.min(__COUNT__, 50));
  const pageSize = Math.max(10, Math.min(count, 20));

  const parseDoc = (doc: Document) => {
    const items = Array.from(
      doc.querySelectorAll(
        "div.g, #search .tF2Cxc, #search .MjjYud, #search [data-hveid][data-ved]"
      )
    );
    const results = [];
    const seen = new Set<string>();
    for (const item of items) {
      const anchor = item.querySelector(
        ".yuRUbf a[href], a[jsname='UWckNb'][href], a[href]"
      ) as HTMLAnchorElement | null;
      const heading = item.querySelector("h3.LC20lb, h3");
      if (!anchor || !heading) continue;
      const link = anchor.getAttribute("href") || "";
      if (!link || link.startsWith("/search") || link.startsWith("#")) continue;
      if (seen.has(link)) continue;

      let snippet = "";
      const snippetBlocks = Array.from(
        item.querySelectorAll(".VwiC3b, .s3v9rd, [data-sncf='1'], span")
      );
      for (const span of snippetBlocks) {
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

      seen.add(link);
      results.push({ title: String(heading.textContent || "").trim(), url: link, snippet });
      if (results.length >= count) break;
    }
    return results;
  };

  let results = parseDoc(document);
  if (results.length === 0) {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${pageSize}&start=0`;
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

  if (results.length < count) {
    const seen = new Set(results.map((item) => item.url).filter(Boolean));
    const maxPages = Math.min(5, Math.ceil(count / 10));
    for (let page = 1; page < maxPages && results.length < count; page += 1) {
      const start = page * 10;
      try {
        const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${pageSize}&start=${start}`;
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) break;
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const pageResults = parseDoc(doc);
        for (const item of pageResults) {
          if (!item.url || seen.has(item.url)) continue;
          seen.add(item.url);
          results.push(item);
          if (results.length >= count) break;
        }
      } catch (_error) {
        break;
      }
    }
  }

  return { query, count: results.length, results: results.slice(0, count) };
};
