// Sample /v1/fetch key parts
// intent.type: topic
// intent.args: {"id":12345,"limit":20}
// output.field: {"author":"posts.author","content":"posts.content","likes":"posts.likes","created_at":"posts.created_at"}
// category: "INTERACTIVE"
// auth.required: false
// auth.kind: "linux-do-cookie"
// auth.description: "linux-do auth credential"
// tags: ["domestic"]

async () => {
  const topicId = __TOPIC_ID__;
  if (!topicId || Number(topicId) <= 0) throw new Error("id is required");
  const response = await fetch(`/t/${encodeURIComponent(String(topicId))}.json`, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} - 请先登录 linux.do`);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error("响应不是有效 JSON - 请先登录 linux.do");
  }
  const stripHtml = (value) =>
    String(value || "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#(?:(\d+)|x([0-9a-fA-F]+));/g, (_match, dec, hex) => {
        try {
          return String.fromCodePoint(dec !== undefined ? Number(dec) : parseInt(hex, 16));
        } catch (_error) {
          return "";
        }
      })
      .replace(/\s+/g, " ")
      .trim();

  const posts = Array.isArray(data?.post_stream?.posts) ? data.post_stream.posts : [];
  return {
    id: topicId,
    count: posts.length,
    posts: posts.slice(0, __COUNT__).map((post) => ({
      author: post?.username || "",
      content: stripHtml(post?.cooked || "").slice(0, 200),
      likes: post?.like_count || 0,
      created_at: post?.created_at || null,
    })),
  };
};
