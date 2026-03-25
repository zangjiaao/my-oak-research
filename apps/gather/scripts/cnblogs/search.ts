/* @meta
{
  "name": "cnblogs/search",
  "description": "获取 cnblogs 的 search 数据",
  "domain": "cnblogs.com",
  "args": {
    "query": {
      "required": true,
      "description": "Script argument: query"
    },
    "page": {
      "required": false,
      "description": "Script argument: page"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site cnblogs/search python 1",
  "category": "RETRIEVAL",
  "auth": {
    "required": true,
    "kind": "cnblogs-cookie",
    "description": "cnblogs auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "query is required" };
  const page = Math.max(1, __PAGE__);

  const parseDoc = (doc: Document) => {
    const items = Array.from(doc.querySelectorAll(".searchItem"));
    const results = [];
    for (const item of items) {
      const titleEl = item.querySelector(".searchItemTitle a");
      if (!titleEl) continue;
      const title = String(titleEl.textContent || "").trim();
      if (!title) continue;
      results.push({
        title,
        url: titleEl.getAttribute("href") || "",
        author: String(item.querySelector(".searchItemInfo-userName a")?.textContent || "").trim(),
        snippet: String(item.querySelector(".searchCon")?.textContent || "").trim().slice(0, 300),
        date: String(item.querySelector(".searchItemInfo-publishDate")?.textContent || "").trim(),
        views: String(item.querySelector(".searchItemInfo-views")?.textContent || "").trim(),
      });
    }
    return results;
  };

  let results = parseDoc(document);
  if (results.length === 0) {
    const url = `https://zzk.cnblogs.com/s?w=${encodeURIComponent(query)}`;
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return { error: `HTTP ${response.status}` };
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      results = parseDoc(doc);
    } catch (_error) {
      return { query, page, count: 0, results: [], hint: "cnblogs fetch failed in page context" };
    }
  }

  return { query, page, count: results.length, results };
};
