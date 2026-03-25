// Sample /v1/fetch key parts
// intent.type: video
// intent.args: {"bvid":"BV1LGwHzrE4A"}
// output.field: {"bvid":"bvid","title":"title","author":"author","view":"stat.view","url":"url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "bilibili-cookie"
// auth.description: "bilibili auth credential"
// tags: ["domestic"]

async () => {
  const bvid = String(__BVID_JSON__ || "").trim();
  if (!bvid) return { error: "Missing argument: bvid" };

  const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) {
    return { error: payload?.message || `API error ${payload?.code}`, hint: payload?.code === -404 ? "Video not found" : "Not logged in?" };
  }

  const video = payload?.data || {};
  const result: any = {
    bvid: video?.bvid || bvid,
    aid: video?.aid || null,
    title: video?.title || "",
    description: video?.desc || "",
    cover: video?.pic || "",
    duration: video?.duration || 0,
    duration_text: video?.duration ? `${Math.floor(video.duration / 60)}:${String(video.duration % 60).padStart(2, "0")}` : "0:00",
    author: video?.owner?.name || "",
    author_mid: video?.owner?.mid || null,
    author_face: video?.owner?.face || "",
    category: video?.tname || "",
    tags: video?.tag || null,
    pub_date: video?.pubdate ? new Date(video.pubdate * 1000).toISOString() : null,
    stat: {
      view: video?.stat?.view || 0,
      like: video?.stat?.like || 0,
      dislike: video?.stat?.dislike || 0,
      coin: video?.stat?.coin || 0,
      favorite: video?.stat?.favorite || 0,
      share: video?.stat?.share || 0,
      reply: video?.stat?.reply || 0,
      danmaku: video?.stat?.danmaku || 0,
    },
    pages: (video?.pages || []).map((page) => ({
      page: page?.page || 0,
      cid: page?.cid || 0,
      title: page?.part || "",
      duration: page?.duration || 0,
    })),
    url: video?.bvid ? `https://www.bilibili.com/video/${video.bvid}` : `https://www.bilibili.com/video/${bvid}`,
  };

  try {
    const relatedResponse = await fetch(`https://api.bilibili.com/x/web-interface/archive/related?bvid=${encodeURIComponent(bvid)}`, { credentials: "include" });
    const relatedPayload = await relatedResponse.json();
    if (relatedPayload?.code === 0 && Array.isArray(relatedPayload?.data)) {
      result.related = relatedPayload.data.slice(0, 5).map((item) => ({
        bvid: item?.bvid || "",
        title: item?.title || "",
        author: item?.owner?.name || "",
        view: item?.stat?.view || 0,
        duration: item?.duration || 0,
        url: item?.bvid ? `https://www.bilibili.com/video/${item.bvid}` : "",
      }));
    }
  } catch (_error) {}

  return result;
};
