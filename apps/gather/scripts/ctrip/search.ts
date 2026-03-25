/* @meta
{
  "name": "ctrip/search",
  "description": "获取 ctrip 的 search 数据",
  "domain": "ctrip.com",
  "args": {
    "query": {
      "required": true,
      "description": "Script argument: query"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site ctrip/search 三亚",
  "category": "RETRIEVAL",
  "auth": {
    "required": false,
    "kind": "ctrip-cookie",
    "description": "ctrip auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "query is required" };

  const parseDestinationDoc = (doc: Document) => {
    const items = doc.querySelectorAll('[class*="result"], [class*="dest-item"], li, .list_mod_item');
    const results = [];
    items.forEach((el) => {
      const linkEl = el.querySelector("a[href]");
      const nameEl = el.querySelector("h2, h3, [class*='name'], [class*='title']");
      if (!linkEl || !nameEl) return;
      const name = String(nameEl.textContent || "").trim();
      const url = linkEl.getAttribute("href") || "";
      if (!name || !url) return;
      if (!results.some((r) => r.name === name && r.url === url)) {
        results.push({ name, url });
      }
    });
    return results;
  };

  const currentPageResults = parseDestinationDoc(document);
  if (currentPageResults.length > 0) {
    return { query, source: "destination_dom", count: currentPageResults.length, results: currentPageResults.slice(0, 15) };
  }

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
  } catch (_error) {}

  try {
    const globalUrl = `https://www.ctrip.com/m/i/webapp/search-result/?query=${encodeURIComponent(query)}`;
    const globalResp = await fetch(globalUrl, { credentials: "include" });
    if (globalResp.ok) {
      const text = await globalResp.text();
      if (text.startsWith("{") || text.startsWith("[")) {
        return { query, source: "global_api", data: JSON.parse(text) };
      }
    }
  } catch (_error) {}

  try {
    const hotelUrl = `https://hotels.ctrip.com/hotels/list?keyword=${encodeURIComponent(query)}`;
    const hotelResp = await fetch(hotelUrl, { credentials: "include" });
    if (hotelResp.ok) {
      const html = await hotelResp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");

      const scripts = Array.from(doc.querySelectorAll("script"));
      for (const script of scripts) {
        const text = script.textContent || "";
        const stateMatch = text.match(/window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:window\.|<\/script>|$)/);
        if (!stateMatch) continue;
        try {
          const state = JSON.parse(stateMatch[1]);
          const hotelList = state?.hotelList || state?.list || state?.hotels;
          if (Array.isArray(hotelList) && hotelList.length > 0) {
            return {
              query,
              source: "hotel_initial_state",
              count: hotelList.length,
              hotels: hotelList.slice(0, 15).map((h) => ({
                name: h?.hotelName || h?.name || "",
                star: h?.star || "",
                score: h?.score || "",
                commentCount: h?.commentCount || 0,
                price: h?.price || h?.minPrice || "",
                address: h?.address || "",
                url: h?.url || h?.detailUrl || "",
              })),
            };
          }
        } catch (_error) {}
      }

      const hotelCards = doc.querySelectorAll('[class*="hotel-card"], [class*="hotelList"], li[class*="list-item"], div[class*="hotel_new_list"]');
      if (hotelCards.length > 0) {
        const hotels = [];
        hotelCards.forEach((card) => {
          const nameEl = card.querySelector("a[class*='name'], h2, [class*='hotel_name']");
          if (!nameEl) return;
          hotels.push({
            name: String(nameEl.textContent || "").trim(),
            score: String(card.querySelector("[class*='score'], [class*='rating']")?.textContent || "").trim(),
            price: String(card.querySelector("[class*='price']")?.textContent || "").trim(),
            address: String(card.querySelector("[class*='address'], [class*='location']")?.textContent || "").trim(),
          });
        });
        if (hotels.length > 0) {
          return { query, source: "hotel_html", count: hotels.length, hotels: hotels.slice(0, 15) };
        }
      }
    }
  } catch (_error) {}

  try {
    const guideUrl = `https://you.ctrip.com/SearchSite/Default/Destination?keyword=${encodeURIComponent(query)}`;
    const guideResp = await fetch(guideUrl, { credentials: "include" });
    if (guideResp.ok) {
      const html = await guideResp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const results = parseDestinationDoc(doc);
      if (results.length > 0) return { query, source: "destination_search", count: results.length, results: results.slice(0, 15) };
    }
  } catch (_error) {}

  try {
    const searchUrl = `https://www.ctrip.com/global-search/result?keyword=${encodeURIComponent(query)}`;
    const searchResp = await fetch(searchUrl, { credentials: "include" });
    if (searchResp.ok) {
      const html = await searchResp.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      const links = Array.from(doc.querySelectorAll("a[href]"));
      const results = [];
      links.forEach((a) => {
        const title = String(a.textContent || "").trim();
        const href = a.getAttribute("href") || "";
        if (title.length <= 4 || title.length >= 200) return;
        if (!href.includes("ctrip.com") || href.includes("javascript:")) return;
        if (!results.some((r) => r.title === title)) {
          results.push({ title, url: href });
        }
      });
      if (results.length > 0) {
        return { query, source: "global_search", count: results.length, results: results.slice(0, 20) };
      }
    }
  } catch (_error) {}

  return {
    query,
    source: "no_results",
    count: 0,
    results: [],
    hint: "No results found. Open www.ctrip.com first, then retry.",
  };
};
