/* @meta
{
  "name": "bilibili/ranking",
  "description": "获取 bilibili 的 ranking 数据",
  "domain": "bilibili.com",
  "args": {
    "category": {
      "required": true,
      "description": "Script argument: category"
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
  "example": "bb-browser site bilibili/ranking 0 20",
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
  const count = Math.max(1, Math.min(__COUNT__, 100));
  const category = Math.max(0, __CATEGORY_ID__);
  const response = await fetch(`https://api.bilibili.com/x/web-interface/ranking/v2?rid=${category}&type=all`, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };

  const categoryNames = {
    0: "all",
    1: "anime",
    3: "music",
    4: "game",
    5: "dance",
    11: "tv",
    36: "knowledge",
    119: "kichiku",
    155: "fashion",
    160: "life",
    165: "ad",
    177: "documentary",
    181: "movie",
    188: "tech",
    202: "info",
    211: "food",
    217: "animal",
    223: "car",
    234: "sports",
  };

  const videos = (payload?.data?.list || []).slice(0, count).map((video, index) => ({
    rank: index + 1,
    bvid: video?.bvid || "",
    title: video?.title || "",
    author: video?.owner?.name || "",
    author_mid: video?.owner?.mid || null,
    cover: video?.pic || "",
    duration: video?.duration || 0,
    view: video?.stat?.view || 0,
    like: video?.stat?.like || 0,
    danmaku: video?.stat?.danmaku || 0,
    coin: video?.stat?.coin || 0,
    favorite: video?.stat?.favorite || 0,
    category: video?.tname || "",
    pub_date: video?.pubdate ? new Date(video.pubdate * 1000).toISOString() : null,
    url: video?.bvid ? `https://www.bilibili.com/video/${video.bvid}` : "",
  }));

  return { category: categoryNames[category] || String(category), count: videos.length, videos };
};
