/* @meta
{
  "name": "bing/search",
  "description": "获取 bing 的 search 数据",
  "domain": "bing.com",
  "args": {
    "query": {
      "required": true,
      "description": "Script argument: query"
    },
    "limit": {
      "required": false,
      "description": "Script argument: limit"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site bing/search openai 10"
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "query is required" };
  const count = Math.max(1, Math.min(__COUNT__, 50));

  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const items = Array.from(doc.querySelectorAll("li.b_algo"));
  const results = items.map((item) => {
    const anchor = item.querySelector("h2 > a");
    if (!anchor) return null;
    return {
      title: String(anchor.textContent || "").trim(),
      url: anchor.getAttribute("href") || "",
      snippet: String(item.querySelector("p")?.textContent || "").trim(),
    };
  }).filter(Boolean);

  return { query, count: results.length, results };
};
