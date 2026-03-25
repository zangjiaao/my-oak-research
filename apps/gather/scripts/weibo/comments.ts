/* @meta
{
  "name": "weibo/comments",
  "description": "获取 weibo 的 comments 数据",
  "domain": "weibo.com",
  "args": {
    "id": {
      "required": true,
      "description": "Script argument: id"
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
  "example": "bb-browser site weibo/comments 5274888946583083 20"
}
*/

async () => {
  const postId = String(__WEIBO_ID_JSON__ || "").trim();
  if (!postId) throw new Error("Missing argument: id");

  let url = `/ajax/statuses/buildComments?flow=0&is_reload=1&id=${encodeURIComponent(postId)}&is_show_bulletin=2&is_mix=0&count=${__COUNT__}`;
  const maxId = String(__MAX_ID_JSON__ || "").trim();
  if (maxId) url += `&max_id=${encodeURIComponent(maxId)}`;

  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (!data?.ok) throw new Error(`API error: ${data?.msg || "unknown"}`);

  const strip = (html) => String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  const comments = (data?.data || []).map((comment) => ({
    id: comment?.idstr || String(comment?.id || ""),
    text: strip(comment?.text || ""),
    created_at: comment?.created_at || "",
    likes_count: comment?.like_count || 0,
    reply_count: comment?.total_number || 0,
    user: {
      id: comment?.user?.id || null,
      screen_name: comment?.user?.screen_name || "",
      verified: Boolean(comment?.user?.verified),
    },
    reply_to: comment?.reply_comment
      ? {
        id: comment?.reply_comment?.idstr || String(comment?.reply_comment?.id || ""),
        user: comment?.reply_comment?.user?.screen_name || "",
        text: strip(comment?.reply_comment?.text || ""),
      }
      : null,
  }));

  return {
    post_id: postId,
    count: comments.length,
    max_id: data?.max_id || null,
    has_more: Boolean(data?.max_id),
    comments,
  };
};
