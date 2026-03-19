// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"artificial intelligence","limit":10}
// output.field: {"title":"results.title","url":"results.url","description":"results.description","date":"results.date"}

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "Missing argument: query", hint: "Provide a search query string" };
  const count = Math.max(1, Math.min(__COUNT__, 40));

  const apiQuery = JSON.stringify({ keyword: query, offset: 0, orderby: "display_date:desc", size: count, website: "reuters" });
  const apiUrl = `https://www.reuters.com/pf/api/v3/content/fetch/articles-by-search-v2?query=${encodeURIComponent(apiQuery)}`;
  try {
    const apiResp = await fetch(apiUrl, { credentials: "include" });
    if (apiResp.ok) {
      const data = await apiResp.json();
      const articles = data?.result?.articles || data?.articles || [];
      if (articles.length > 0) {
        const results = articles.slice(0, count).map((article) => ({
          title: article?.title || article?.headlines?.basic || "",
          description: article?.description?.basic || article?.description || article?.subheadlines?.basic || "",
          date: article?.display_date || article?.published_time || article?.first_publish_date || "",
          url: article?.canonical_url ? `https://www.reuters.com${article.canonical_url}` : (article?.website_url ? `https://www.reuters.com${article.website_url}` : ""),
          section: article?.taxonomy?.section?.name || article?.section?.name || "",
          authors: (article?.authors || []).map((author) => author?.name).filter(Boolean).join(", "),
        }));
        return { query, source: "api", count: results.length, results, items: results };
      }
    }
  } catch (_error) {}

  const searchUrl = `https://www.reuters.com/site-search/?query=${encodeURIComponent(query)}&offset=0`;
  const response = await fetch(searchUrl, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Make sure a reuters.com tab is open" };

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const results = [];
  const seen = new Set();
  const cards = doc.querySelectorAll('[class*="search-result"], [class*="media-story"], [data-testid*="search"], li[class*="story"], article');
  for (const card of Array.from(cards)) {
    if (results.length >= count) break;
    const anchor = card.querySelector("a[href]");
    if (!anchor) continue;
    const href = anchor.getAttribute("href") || "";
    const fullUrl = href.startsWith("http") ? href : `https://www.reuters.com${href}`;
    if (seen.has(fullUrl) || !href.includes("/") || href === "/") continue;

    const heading = card.querySelector("h3, h2, h4, [data-testid*='Heading'], span[class*='title']");
    const title = String((heading?.textContent || anchor.textContent || "")).trim();
    if (!title || title.length < 5) continue;

    let description = "";
    for (const p of Array.from(card.querySelectorAll("p, [class*='description'], [class*='snippet']"))) {
      const txt = String(p.textContent || "").trim();
      if (txt.length > 15 && txt !== title) {
        description = txt.slice(0, 500);
        break;
      }
    }

    const timeEl = card.querySelector("time, [class*='date'], [class*='time']");
    const date = timeEl ? (timeEl.getAttribute("datetime") || String(timeEl.textContent || "").trim()) : "";
    seen.add(fullUrl);
    results.push({ title, description, date, url: fullUrl });
  }

  if (results.length === 0) {
    const links = doc.querySelectorAll("a[href]");
    for (const anchor of Array.from(links)) {
      if (results.length >= count) break;
      const href = anchor.getAttribute("href") || "";
      if (
        !(
          href.includes("/world/") ||
          href.includes("/business/") ||
          href.includes("/markets/") ||
          href.includes("/technology/") ||
          href.includes("/science/") ||
          href.includes("/sports/") ||
          href.includes("/legal/") ||
          href.includes("/sustainability/")
        )
      ) {
        continue;
      }
      const fullUrl = href.startsWith("http") ? href : `https://www.reuters.com${href}`;
      if (seen.has(fullUrl)) continue;

      const heading = anchor.querySelector("h1, h2, h3, h4, span");
      const title = String((heading?.textContent || anchor.textContent || "")).trim();
      if (!title || title.length < 8) continue;

      seen.add(fullUrl);

      let description = "";
      const parent = anchor.closest("li, div, article, section");
      if (parent) {
        for (const paragraph of Array.from(parent.querySelectorAll("p"))) {
          const text = String(paragraph.textContent || "").trim();
          if (text.length > 15 && text !== title) {
            description = text.slice(0, 500);
            break;
          }
        }
      }

      results.push({ title, description, url: fullUrl });
    }
  }

  if (results.length === 0) {
    return {
      query,
      count: 0,
      results: [],
      items: [],
      hint: "No results found. Ensure reuters.com is open and not blocked by captcha.",
    };
  }
  return { query, source: "html", count: results.length, results, items: results };
};
