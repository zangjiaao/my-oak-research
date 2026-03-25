/* @meta
{
  "name": "toutiao/search",
  "description": "获取 toutiao 的 search 数据",
  "domain": "toutiao.com",
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
  "example": "bb-browser site toutiao/search AI 10",
  "category": "STREAM",
  "auth": {
    "required": false,
    "kind": "toutiao-cookie",
    "description": "toutiao auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "Missing argument: query", hint: "Provide a search keyword" };
  const count = Math.max(1, Math.min(__COUNT__, 20));

  const extractArticleUrl = (href) => {
    if (!href) return "";
    try {
      let decoded = href;
      for (let i = 0; i < 5; i += 1) {
        const match = decoded.match(/toutiao\.com(?:%2F|\/)+a?(\d{15,})/);
        if (match) return `https://www.toutiao.com/article/${match[1]}/`;
        const groupMatch = decoded.match(/group(?:%2F|\/)(\d{15,})/);
        if (groupMatch) return `https://www.toutiao.com/article/${groupMatch[1]}/`;
        decoded = decodeURIComponent(decoded);
      }
    } catch (_error) {}
    return href;
  };

  const parseDoc = (doc: Document) => {
    const results = [];
    for (const card of Array.from(doc.querySelectorAll(".cs-card"))) {
      const titleLink = card.querySelector("a[href*='search/jump']");
      if (!titleLink) continue;
      const title = String(titleLink.textContent || "").trim();
      if (!title || title.length < 2) continue;
      if (title.includes("去西瓜搜") || title.includes("去抖音搜")) continue;

      const articleUrl = extractArticleUrl(titleLink.getAttribute("href") || "");
      let rest = String(card.textContent || "").trim();
      const titleIdx = rest.indexOf(title);
      if (titleIdx >= 0) rest = rest.substring(titleIdx + title.length);
      const titleIdx2 = rest.indexOf(title);
      if (titleIdx2 >= 0) rest = rest.substring(titleIdx2 + title.length);
      rest = rest.replace(/\d+评论/g, "").trim();

      let time = "";
      const timeMatch = rest.match(/((?<=[^\d])|^)(\d{1,2}(?:小时|分钟|天)前|前天[\d:]*|昨天[\d:]*|\d{4}[-/.]\d{2}[-/.]\d{2}.*)$/);
      if (timeMatch) {
        time = (timeMatch[2] || timeMatch[0]).trim();
        rest = rest.substring(0, rest.length - timeMatch[0].length).trim();
      }

      let snippet = "";
      let source = "";
      const sourceMatch = rest.match(/^([\s\S]+?)([\u4e00-\u9fa5A-Za-z][\u4e00-\u9fa5A-Za-z0-9_\s]{1,19})$/);
      if (sourceMatch && sourceMatch[1].length > 10) {
        snippet = sourceMatch[1].trim().slice(0, 300);
        source = sourceMatch[2].trim();
      } else {
        snippet = rest.slice(0, 300);
      }

      results.push({ title, snippet, source, time, url: articleUrl });
      if (results.length >= count) break;
    }
    return results;
  };

  let results = parseDoc(document);
  if (results.length === 0) {
    try {
      const url = `https://so.toutiao.com/search?keyword=${encodeURIComponent(query)}&pd=information&dvpf=pc`;
      const response = await fetch(url, { credentials: "include" });
      if (response.ok) {
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        results = parseDoc(doc);
      } else {
        return { query, count: 0, results: [], hint: `toutiao search status ${response.status}` };
      }
    } catch (_error) {
      return { query, count: 0, results: [], hint: "toutiao fetch failed in page context" };
    }
  }

  if (results.length === 0) {
    return { query, count: 0, results: [], hint: "No results found. Toutiao may require login." };
  }

  return { query, count: results.length, results };
};
