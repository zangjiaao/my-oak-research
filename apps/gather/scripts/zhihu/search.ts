/* @meta
{
  "name": "zhihu/search",
  "description": "获取 zhihu 的 search 数据",
  "domain": "zhihu.com",
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
  "example": "bb-browser site zhihu/search openai 10"
}
*/

async () => {
  const keyword = String(__KEYWORD_JSON__ || "").trim();
  if (!keyword) {
    return { error: "Missing argument: keyword" };
  }

  const count = Math.max(1, Math.min(__COUNT__, 20));
  const response = await fetch(
    `https://www.zhihu.com/api/v4/search_v3?q=${encodeURIComponent(keyword)}&t=general&offset=0&limit=${count}`,
    { credentials: "include" },
  );
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  }

  const payload = await response.json();
  const strip = (html) => String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/<em>/g, "")
    .replace(/<\/em>/g, "")
    .trim();

  const results = (payload?.data || [])
    .filter((item) => item?.type === "search_result")
    .map((item, index) => {
      const obj = item?.object || {};
      const question = obj?.question || {};
      const objType = obj?.type || "";
      const objId = obj?.id || "";
      const qid = question?.id || objId || "";
      let url = `https://www.zhihu.com/question/${qid}`;
      if (objType === "answer") {
        url = `https://www.zhihu.com/question/${qid}/answer/${objId}`;
      } else if (objType === "article") {
        url = `https://zhuanlan.zhihu.com/p/${objId}`;
      }

      return {
        rank: index + 1,
        type: objType,
        id: objId,
        title: strip(obj?.title || question?.name || ""),
        excerpt: strip(obj?.excerpt || ""),
        url,
        author: obj?.author?.name || "",
        voteup_count: obj?.voteup_count || 0,
        comment_count: obj?.comment_count || 0,
        question_id: qid || null,
        question_title: strip(question?.name || ""),
        created_time: obj?.created_time || null,
        updated_time: obj?.updated_time || null,
      };
    });

  return {
    keyword,
    count: results.length,
    has_more: !(payload?.paging?.is_end ?? true),
    results,
  };
};
