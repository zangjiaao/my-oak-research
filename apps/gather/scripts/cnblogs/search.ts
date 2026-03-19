// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"python","page":1}
// output.field: {"title":"results.title","url":"results.url","author":"results.author","snippet":"results.snippet"}

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "query is required" };
  const page = Math.max(1, __PAGE__);

  const url = `https://zzk.cnblogs.com/s?w=${encodeURIComponent(query)}&p=${page}`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const html = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

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

  return { query, page, count: results.length, results };
};
