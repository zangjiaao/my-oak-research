/* @meta
{
  "name": "bilibili/popular",
  "description": "获取 bilibili 的 popular 数据",
  "domain": "bilibili.com",
  "args": {
    "limit": {
      "required": false,
      "description": "Script argument: limit"
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
  "example": "bb-browser site bilibili/popular 20 1"
}
*/

async () => {
  const count = Math.max(1, Math.min(__COUNT__, 50));
  const page = Math.max(1, __PAGE__);
  const response = await fetch(`https://api.bilibili.com/x/web-interface/popular?ps=${count}&pn=${page}`, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };

  const videos = (payload?.data?.list || []).map((video, index) => ({
    rank: (page - 1) * count + index + 1,
    bvid: video?.bvid || "",
    title: video?.title || "",
    author: video?.owner?.name || "",
    author_mid: video?.owner?.mid || null,
    cover: video?.pic || "",
    duration: video?.duration || 0,
    view: video?.stat?.view || 0,
    like: video?.stat?.like || 0,
    danmaku: video?.stat?.danmaku || 0,
    reply: video?.stat?.reply || 0,
    favorite: video?.stat?.favorite || 0,
    coin: video?.stat?.coin || 0,
    share: video?.stat?.share || 0,
    category: video?.tname || "",
    pub_date: video?.pubdate ? new Date(video.pubdate * 1000).toISOString() : null,
    url: video?.bvid ? `https://www.bilibili.com/video/${video.bvid}` : "",
    reason: video?.rcmd_reason?.content || null,
  }));

  return {
    page,
    count: videos.length,
    no_more: Boolean(payload?.data?.no_more),
    videos,
  };
};
