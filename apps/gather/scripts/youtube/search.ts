// Sample /v1/fetch key parts
// intent.type: search
// intent.args: {"query":"openai","limit":20}
// output.field: {"rank":"videos.rank","title":"videos.title","channel":"videos.channel","views":"videos.views","duration":"videos.duration","url":"videos.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "youtube-cookie"
// auth.description: "youtube auth credential"
// tags: ["foreign"]

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) throw new Error("query is required");

  const cfg = window.ytcfg?.data_ || {};
  const apiKey = cfg.INNERTUBE_API_KEY;
  const context = cfg.INNERTUBE_CONTEXT;
  if (!apiKey || !context) throw new Error("YouTube config not found");

  const response = await fetch(`/youtubei/v1/search?key=${apiKey}&prettyPrint=false`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ context, query }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const sections = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const videos = [];
  for (const section of sections) {
    const items = section?.itemSectionRenderer?.contents || [];
    for (const item of items) {
      const video = item?.videoRenderer;
      if (!video) continue;
      if (videos.length >= __COUNT__) break;
      videos.push({
        rank: videos.length + 1,
        title: video?.title?.runs?.[0]?.text || "",
        channel: video?.ownerText?.runs?.[0]?.text || "",
        views: video?.viewCountText?.simpleText || video?.shortViewCountText?.simpleText || "",
        duration: video?.lengthText?.simpleText || "LIVE",
        url: `https://www.youtube.com/watch?v=${video?.videoId || ""}`,
      });
    }
    if (videos.length >= __COUNT__) break;
  }

  return {
    query,
    count: videos.length,
    videos,
  };
};
