/* @meta
{
  "name": "youtube/channel",
  "description": "获取 youtube 的 channel 数据",
  "domain": "youtube.com",
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
  "example": "bb-browser site youtube/channel @programmingwithmosh 10",
  "category": "INTERACTIVE",
  "auth": {
    "required": true,
    "kind": "youtube-cookie",
    "description": "youtube auth credential"
  },
  "tags": [
    "foreign"
  ]
}
*/

async () => {
  const cfg = window.ytcfg?.data_ || {};
  const apiKey = cfg.INNERTUBE_API_KEY;
  const context = cfg.INNERTUBE_CONTEXT;
  if (!apiKey || !context) throw new Error("YouTube config not found");

  let browseId = String(__CHANNEL_ID_JSON__ || "").trim();
  const max = Math.max(1, Math.min(__COUNT__, 30));

  if (!browseId) {
    const matched = location.href.match(/youtube\.com\/(channel\/|c\/|@)([^/?]+)/);
    if (matched) {
      browseId = matched[1] === "channel/" ? matched[2] : `@${String(matched[2] || "").replace(/^@/, "")}`;
    }
  }
  if (!browseId) throw new Error("No channel ID or handle");

  let resolvedBrowseId = browseId;
  if (browseId.startsWith("@")) {
    const resolveResponse = await fetch(`/youtubei/v1/navigation/resolve_url?key=${apiKey}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context,
        url: `https://www.youtube.com/${browseId}`,
      }),
    });
    if (resolveResponse.ok) {
      const resolveData = await resolveResponse.json();
      resolvedBrowseId = resolveData?.endpoint?.browseEndpoint?.browseId || browseId;
    }
  }

  const response = await fetch(`/youtubei/v1/browse?key=${apiKey}&prettyPrint=false`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context,
      browseId: resolvedBrowseId,
    }),
  });
  if (!response.ok) throw new Error(`Channel API returned HTTP ${response.status}`);

  const data = await response.json();
  const metadata = data?.metadata?.channelMetadataRenderer || {};
  const header = data?.header?.pageHeaderRenderer || data?.header?.c4TabbedHeaderRenderer || {};
  const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
  const tabNames = tabs
    .map((tab) => tab?.tabRenderer?.title || tab?.expandableTabRenderer?.title)
    .filter(Boolean);

  let subscriberCount = "";
  const rows = header?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
  for (const row of rows) {
    for (const part of row?.metadataParts || []) {
      const text = String(part?.text?.content || "");
      if (text.includes("subscriber")) subscriberCount = text;
    }
  }

  const recentVideos = [];
  const homeTab = tabs.find((tab) => tab?.tabRenderer?.selected);
  const sections = homeTab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
  for (const section of sections) {
    if (recentVideos.length >= max) break;
    const shelfItems = section?.itemSectionRenderer?.contents || [];
    for (const shelf of shelfItems) {
      if (recentVideos.length >= max) break;
      const items = shelf?.shelfRenderer?.content?.horizontalListRenderer?.items || [];
      for (const item of items) {
        if (recentVideos.length >= max) break;
        const lockup = item?.lockupViewModel;
        if (lockup && lockup?.contentType === "LOCKUP_CONTENT_TYPE_VIDEO") {
          const lockMeta = lockup?.metadata?.lockupMetadataViewModel;
          const lockRows = lockMeta?.metadata?.contentMetadataViewModel?.metadataRows || [];
          const viewsAndTime = (lockRows?.[0]?.metadataParts || [])
            .map((part) => part?.text?.content)
            .filter(Boolean)
            .join(" | ");
          let duration = "";
          const overlays = lockup?.contentImage?.thumbnailViewModel?.overlays || [];
          for (const overlay of overlays) {
            for (const badge of overlay?.thumbnailBottomOverlayViewModel?.badges || []) {
              if (badge?.thumbnailBadgeViewModel?.text) duration = badge.thumbnailBadgeViewModel.text;
            }
          }
          recentVideos.push({
            videoId: lockup?.contentId || "",
            title: lockMeta?.title?.content || "",
            duration,
            viewsAndTime,
            url: `https://www.youtube.com/watch?v=${lockup?.contentId || ""}`,
          });
          continue;
        }

        const video = item?.gridVideoRenderer;
        if (video) {
          recentVideos.push({
            videoId: video?.videoId || "",
            title: video?.title?.runs?.[0]?.text || video?.title?.simpleText || "",
            duration: video?.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || "",
            viewsAndTime: `${video?.shortViewCountText?.simpleText || ""}${video?.publishedTimeText?.simpleText ? ` | ${video.publishedTimeText.simpleText}` : ""}`,
            url: `https://www.youtube.com/watch?v=${video?.videoId || ""}`,
          });
        }
      }
    }
  }

  return {
    channelId: metadata?.externalId || resolvedBrowseId,
    name: metadata?.title || "",
    handle: String(metadata?.vanityChannelUrl || "").split("/").pop() || "",
    description: String(metadata?.description || "").slice(0, 500),
    subscriberCount,
    channelUrl: metadata?.channelUrl || `https://www.youtube.com/channel/${resolvedBrowseId}`,
    keywords: metadata?.keywords || "",
    isFamilySafe: Boolean(metadata?.isFamilySafe),
    tabs: tabNames,
    recentVideoCount: recentVideos.length,
    recentVideos,
  };
};
