/* @meta
{
  "name": "linux-do/search",
  "description": "获取 linux-do 的 search 数据",
  "domain": "linux.do",
  "args": {
    "keyword": {
      "required": true,
      "description": "Script argument: keyword"
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
  "example": "bb-browser site linux-do/search playwright 20"
}
*/

async () => {
  const keyword = String(__KEYWORD_JSON__ || "").trim();
  if (!keyword) throw new Error("keyword is required");
  const response = await fetch(`/search.json?q=${encodeURIComponent(keyword)}`, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} - 请先登录 linux.do`);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error("响应不是有效 JSON - 请先登录 linux.do");
  }
  const topics = Array.isArray(data?.topics) ? data.topics : [];
  return {
    keyword,
    count: topics.length,
    topics: topics.slice(0, __COUNT__).map((topic, index) => ({
      rank: index + 1,
      title: topic?.title || "",
      views: topic?.views || 0,
      likes: topic?.like_count || 0,
      replies: Math.max(0, (topic?.posts_count || 1) - 1),
    })),
  };
};
