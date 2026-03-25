/* @meta
{
  "name": "bilibili/comments",
  "description": "获取 bilibili 的 comments 数据",
  "domain": "bilibili.com",
  "args": {
    "bvid": {
      "required": true,
      "description": "Script argument: bvid"
    },
    "page": {
      "required": false,
      "description": "Script argument: page"
    },
    "limit": {
      "required": false,
      "description": "Script argument: limit"
    },
    "sort": {
      "required": true,
      "description": "Script argument: sort"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site bilibili/comments BV1LGwHzrE4A 1",
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
  const bvid = String(__BVID_JSON__ || "").trim();
  if (!bvid) return { error: "Missing argument: bvid" };

  const page = Math.max(1, __PAGE__);
  const count = Math.max(1, Math.min(__COUNT__, 30));
  const sort = __SORT__ === 0 ? 0 : 2;

  const viewResponse = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { credentials: "include" });
  if (!viewResponse.ok) return { error: `HTTP ${viewResponse.status}`, hint: "Not logged in?" };
  const viewPayload = await viewResponse.json();
  if (viewPayload?.code !== 0) {
    return { error: viewPayload?.message || "Failed to get video info", hint: viewPayload?.code === -404 ? "Video not found" : "Not logged in?" };
  }
  const aid = viewPayload?.data?.aid;

  const response = await fetch(`https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&pn=${page}&ps=${count}&sort=${sort}`, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };

  const formatReply = (reply) => ({
    rpid: reply?.rpid_str || "",
    user: reply?.member?.uname || "",
    user_mid: reply?.mid || null,
    user_level: reply?.member?.level_info?.current_level || 0,
    content: reply?.content?.message || "",
    like: reply?.like || 0,
    reply_count: reply?.rcount || 0,
    time: reply?.ctime ? new Date(reply.ctime * 1000).toISOString() : null,
    sub_replies: (reply?.replies || []).slice(0, 3).map((subReply) => ({
      user: subReply?.member?.uname || "",
      content: subReply?.content?.message || "",
      like: subReply?.like || 0,
      time: subReply?.ctime ? new Date(subReply.ctime * 1000).toISOString() : null,
    })),
  });

  const comments = (payload?.data?.replies || []).map(formatReply);
  const topComments = page === 1 && Array.isArray(payload?.data?.top_replies) ? payload.data.top_replies.map(formatReply) : null;

  return {
    bvid,
    aid,
    title: viewPayload?.data?.title || "",
    page,
    total: payload?.data?.page?.count || 0,
    count: comments.length,
    sort: sort === 0 ? "by_time" : "by_likes",
    top_comments: topComments,
    comments,
  };
};
