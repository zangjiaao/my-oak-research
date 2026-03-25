/* @meta
{
  "name": "bbc/news",
  "description": "获取 bbc 的 news 数据",
  "domain": "bbc.com",
  "args": {
    "limit": {
      "required": false,
      "description": "Script argument: limit"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site bbc/news 20"
}
*/

async () => {
  const decodeEntities = (value) =>
    String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  const xmlText = document.documentElement?.outerHTML || document.body?.innerText || "";
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const headlines = [];
  let match = itemRegex.exec(xmlText);
  while (match && headlines.length < __LIMIT__) {
    const block = match[1] || "";
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const descMatch = block.match(/<description>([\s\S]*?)<\/description>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i) || block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const title = decodeEntities(titleMatch?.[1] || "").trim();
    if (title) {
      headlines.push({
        rank: headlines.length + 1,
        title,
        description: decodeEntities(descMatch?.[1] || "").trim().slice(0, 200),
        url: decodeEntities(linkMatch?.[1] || "").trim(),
      });
    }
    match = itemRegex.exec(xmlText);
  }

  return {
    source: "https://feeds.bbci.co.uk/news/rss.xml",
    count: headlines.length,
    items: headlines.slice(0, __COUNT__),
  };
};
