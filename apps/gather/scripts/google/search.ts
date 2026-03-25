// Sample /v1/fetch key parts
// intent.type: search
// intent.args: {"query":"openai","limit":10}
// output.field: {"title":"results.title","url":"results.url","snippet":"results.snippet"}
// category: "RETRIEVAL"
// auth.required: true
// auth.kind: "google-cookie"
// auth.description: "google auth credential"
// tags: ["foreign"]

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "Missing argument: query", hint: "Provide a search query string" };
  const count = Math.max(1, Math.min(__COUNT__, 50));
  const maxScrollRounds = Math.min(8, Math.max(2, Math.ceil(count / 5)));

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

  const extractNextPageUrl = (doc: Document): string => {
    const direct =
      (doc.querySelector("#pnnext") as HTMLAnchorElement | null) ||
      (doc.querySelector("a[aria-label='下一页']") as HTMLAnchorElement | null) ||
      (doc.querySelector("a[aria-label='Next']") as HTMLAnchorElement | null);
    if (direct) {
      const href = direct.getAttribute("href") || "";
      if (href) return new URL(href, "https://www.google.com").toString();
    }

    const nextSpan = Array.from(doc.querySelectorAll("span.oeN89d")).find((node) => {
      const text = String(node.textContent || "").trim();
      return text === "下一页" || text.toLowerCase() === "next";
    });
    if (nextSpan) {
      const anchor = nextSpan.closest("a") as HTMLAnchorElement | null;
      const href = anchor?.getAttribute("href") || "";
      if (href) return new URL(href, "https://www.google.com").toString();
    }

    return "";
  };

  const mergeResults = (
    base: Array<{ title: string; url: string; snippet: string }>,
    incoming: Array<{ title: string; url: string; snippet: string }>
  ) => {
    const merged = [...base];
    const seen = new Set(merged.map((item) => item.url).filter(Boolean));
    for (const item of incoming) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      merged.push(item);
      if (merged.length >= count) break;
    }
    return merged;
  };

  const captureFromCurrentPageWithScroll = async () => {
    let merged = parseDoc(document);
    for (let round = 0; round < maxScrollRounds && merged.length < count; round += 1) {
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const nextBatch = parseDoc(document);
      merged = mergeResults(merged, nextBatch);
    }
    return merged;
  };

  let results = await captureFromCurrentPageWithScroll();
  let nextPageUrl = extractNextPageUrl(document);
  if (results.length === 0) {
    try {
      const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=20`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        return { query, count: 0, results: [], hint: `google fetch status ${response.status}` };
      }
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      results = parseDoc(doc);
      nextPageUrl = extractNextPageUrl(doc);
    } catch (_error) {
      return { query, count: 0, results: [], hint: "google fetch failed in page context" };
    }
  }

  if (results.length < count && nextPageUrl) {
    let merged = [...results];
    const maxPages = Math.min(8, Math.ceil(count / 10) + 1);
    for (let page = 0; page < maxPages && merged.length < count && nextPageUrl; page += 1) {
      try {
        const currentPageUrl = nextPageUrl;
        const response = await fetch(nextPageUrl, { credentials: "include" });
        if (!response.ok) break;
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const pageResults = parseDoc(doc);
        const candidateNext = extractNextPageUrl(doc);
        merged = mergeResults(merged, pageResults);
        nextPageUrl = candidateNext && candidateNext !== currentPageUrl ? candidateNext : "";
      } catch (_error) {
        break;
      }
    }
    results = merged;
  }

  return { query, count: results.length, results: results.slice(0, count) };
};
