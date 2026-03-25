/* @meta
{
  "name": "duckduckgo/search",
  "description": "获取 duckduckgo 的 search 数据",
  "domain": "duckduckgo.com",
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
  "example": "bb-browser site duckduckgo/search openai"
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "Missing argument: query", hint: "Provide a search query string" };

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url);
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const items = Array.from(doc.querySelectorAll(".result"));
  const results = items.map((item) => {
    const anchor = item.querySelector(".result__a");
    if (!anchor) return null;
    let href = anchor.getAttribute("href") || "";
    const udMatch = href.match(/[?&]uddg=([^&]+)/);
    if (udMatch) href = decodeURIComponent(udMatch[1]);
    return {
      title: String(anchor.textContent || "").trim(),
      url: href,
      snippet: String(item.querySelector(".result__snippet")?.textContent || "").trim(),
    };
  }).filter(Boolean);

  return { query, count: results.length, results };
};
