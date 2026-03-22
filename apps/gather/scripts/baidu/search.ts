// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"openai","limit":10}
// output.field: {"title":"results.title","url":"results.url","snippet":"results.snippet"}
// category: "RETRIEVAL"
// auth.required: false
// auth.kind: "baidu-cookie"
// auth.description: "baidu auth credential"
// tags: ["domestic"]

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
