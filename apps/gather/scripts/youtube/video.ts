// Sample /v3/fetch key parts
// intent.type: video
// intent.args: {"url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
// output.field: {"title":"title","channel":"channel","views":"views","duration":"duration","publishDate":"publishDate","description":"description"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "youtube-cookie"
// auth.description: "youtube auth credential"
// tags: ["foreign"]

async () => {
  const parseVideoId = (input) => {
    if (!String(input || "").startsWith("http")) return String(input || "").trim();
    try {
      const parsed = new URL(String(input));
      const byV = parsed.searchParams.get("v");
      if (byV) return byV;
      if (parsed.hostname === "youtu.be") return parsed.pathname.slice(1).split("/")[0] || "";
      const matched = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([^/?]+)/);
      if (matched) return matched[2] || "";
    } catch (_error) {}
    return String(input || "").trim();
  };

  const rawUrl = String(__URL_JSON__ || "").trim();
  const videoId = parseVideoId(rawUrl);
  if (!videoId) throw new Error("url is required");
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  if (location.href.indexOf(videoId) === -1) {
    location.assign(watchUrl);
    return { error: "navigating", hint: "retry after navigation" };
  }

  const player = window.ytInitialPlayerResponse;
  const yt = window.ytInitialData;
  if (!player) throw new Error("ytInitialPlayerResponse not found");

  const details = player.videoDetails || {};
  const microformat = player.microformat?.playerMicroformatRenderer || {};
  let fullDescription = details.shortDescription || "";
  try {
    const contents = yt?.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
    for (const item of contents) {
      const desc = item?.videoSecondaryInfoRenderer?.attributedDescription?.content;
      if (desc) {
        fullDescription = desc;
        break;
      }
    }
  } catch (_error) {}

  return {
    title: details.title || "",
    channel: details.author || "",
    channelId: details.channelId || "",
    videoId: details.videoId || videoId,
    views: details.viewCount || "",
    duration: details.lengthSeconds ? `${details.lengthSeconds}s` : "",
    publishDate: microformat.publishDate || microformat.uploadDate || details.publishDate || "",
    category: microformat.category || "",
    description: fullDescription,
    keywords: Array.isArray(details.keywords) ? details.keywords.join(", ") : "",
    isLive: Boolean(details.isLiveContent),
    thumbnail: details.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || "",
    url: watchUrl,
  };
};
