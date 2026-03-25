/* @meta
{
  "name": "csdn/search",
  "description": "获取 csdn 的 search 数据",
  "domain": "csdn.net",
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
  "example": "bb-browser site csdn/search python 1"
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "Missing argument: query" };
  const page = Math.max(1, __PAGE__);

  const url = `https://so.csdn.net/api/v3/search?q=${encodeURIComponent(query)}&t=all&p=${page}&s=0&tm=0&lv=-1&ft=0&l=&u=&ct=-1&pnt=-1&ry=-1&ss=-1&dct=-1&vco=-1&cc=-1&sc=-1&ald=-1&ep=&wp=0`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Make sure so.csdn.net is accessible" };

  const payload = await response.json();
  const strip = (html) => String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  const results = (payload?.result_vos || []).map((item, index) => ({
    rank: (page - 1) * 20 + index + 1,
    type: item?.type || "",
    title: strip(item?.title || ""),
    url: item?.url || "",
    description: strip(item?.description || item?.body || "").slice(0, 300),
    author: item?.nickname || item?.author || "",
    views: parseInt(item?.view || "0", 10) || 0,
    likes: parseInt(item?.digg || "0", 10) || 0,
    collections: parseInt(item?.collections || "0", 10) || 0,
    created: item?.create_time ? new Date(parseInt(item.create_time, 10)).toISOString() : null,
  }));

  return { query, page, total: payload?.total || 0, count: results.length, results };
};
