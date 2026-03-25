/* @meta
{
  "name": "bilibili/search",
  "description": "获取 bilibili 的 search 数据",
  "domain": "bilibili.com",
  "args": {
    "query": {
      "required": true,
      "description": "Script argument: query"
    },
    "limit": {
      "required": false,
      "description": "Script argument: limit"
    },
    "page": {
      "required": false,
      "description": "Script argument: page"
    },
    "order": {
      "required": true,
      "description": "Script argument: order"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site bilibili/search openai 20",
  "category": "INTERACTIVE",
  "auth": {
    "required": true,
    "kind": "bilibili-cookie",
    "description": "bilibili auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const keyword = String(__KEYWORD_JSON__ || "").trim();
  if (!keyword) return { error: "Missing argument: keyword" };

  const page = Math.max(1, __PAGE__);
  const count = Math.max(1, Math.min(__COUNT__, 50));
  const order = String(__ORDER_JSON__ || "totalrank");
  const params = new URLSearchParams({
    search_type: "video",
    keyword,
    page: String(page),
    page_size: String(count),
    order,
  });

  const response = await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${params.toString()}`, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };

  const stripHtml = (value) => String(value || "").replace(/<[^>]*>/g, "");
  const videos = (payload?.data?.result || []).map((item) => ({
    bvid: item?.bvid || "",
    title: stripHtml(item?.title || ""),
    author: item?.author || "",
    author_mid: item?.mid || null,
    description: stripHtml(item?.description || "").slice(0, 200),
    duration: item?.duration || "",
    play: item?.play || 0,
    danmaku: item?.danmaku || 0,
    like: item?.like || 0,
    favorites: item?.favorites || 0,
    cover: String(item?.pic || "").startsWith("//") ? `https:${item.pic}` : item?.pic || "",
    pub_date: item?.pubdate ? new Date(item.pubdate * 1000).toISOString() : null,
    tags: item?.tag || "",
    url: item?.bvid ? `https://www.bilibili.com/video/${item.bvid}` : "",
  }));

  return {
    keyword,
    page,
    total: payload?.data?.numResults || 0,
    count: videos.length,
    videos,
  };
};
