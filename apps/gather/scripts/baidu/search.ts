/* @meta
{
  "name": "baidu/search",
  "description": "获取 baidu 的 search 数据",
  "domain": "baidu.com",
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
  "example": "bb-browser site baidu/search openai 10",
  "category": "RETRIEVAL",
  "auth": {
    "required": false,
    "kind": "baidu-cookie",
    "description": "baidu auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "query is required" };
  const count = Math.max(1, Math.min(__COUNT__, 50));

  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&rn=${count}`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const containers = doc.querySelectorAll("div.result, div.c-container");
  const results = [];
  for (const element of containers) {
    const titleEl = element.querySelector("h3 a") || element.querySelector("a[href]");
    if (!titleEl) continue;
    const title = String(titleEl.textContent || "").trim();
    if (!title) continue;
    const href = titleEl.getAttribute("href") || "";
    const snippetEl = element.querySelector(".c-abstract, .c-span-last, span.content-right_8Zs40") || element.querySelector("span[class*='content'], div[class*='abstract']");
    const snippet = snippetEl ? String(snippetEl.textContent || "").trim().slice(0, 300) : "";
    results.push({ title, url: href, snippet });
  }

  return { query, count: results.length, results };
};
