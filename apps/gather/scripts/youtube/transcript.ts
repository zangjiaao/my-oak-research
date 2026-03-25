/* @meta
{
  "name": "youtube/transcript",
  "description": "获取 youtube 的 transcript 数据",
  "domain": "youtube.com",
  "args": {
    "url": {
      "required": true,
      "description": "Script argument: url"
    },
    "lang": {
      "required": true,
      "description": "Script argument: lang"
    },
    "mode": {
      "required": true,
      "description": "Script argument: mode"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site youtube/transcript https://www.youtube.com/watch?v=dQw4w9WgXcQ en"
}
*/

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

  const fmtTime = (seconds) => {
    const sec = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${m}:${String(s).padStart(2, "0")}`;
  };

  const decodeEntities = (value) =>
    String(value || "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  const videoId = parseVideoId(String(__URL_JSON__ || "").trim());
  const lang = String(__LANG_JSON__ || "").trim();
  const mode = String(__MODE_JSON__ || "grouped").trim().toLowerCase() || "grouped";
  if (!videoId) throw new Error("url is required");

  const cfg = window.ytcfg?.data_ || {};
  const apiKey = cfg.INNERTUBE_API_KEY;
  if (!apiKey) throw new Error("INNERTUBE_API_KEY not found");

  const playerResponse = await fetch(`/youtubei/v1/player?key=${apiKey}&prettyPrint=false`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId,
    }),
  });
  if (!playerResponse.ok) throw new Error(`InnerTube player API returned HTTP ${playerResponse.status}`);
  const playerData = await playerResponse.json();

  const renderer = playerData?.captions?.playerCaptionsTracklistRenderer;
  const tracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks : [];
  if (!tracks.length) throw new Error("No captions available for this video");

  let track = null;
  if (lang) {
    track = tracks.find((item) => item?.languageCode === lang) || tracks.find((item) => String(item?.languageCode || "").startsWith(lang));
  }
  if (!track) track = tracks.find((item) => item?.kind !== "asr") || tracks[0];
  if (!track?.baseUrl) throw new Error("Caption URL unavailable");

  const xmlResponse = await fetch(track.baseUrl);
  const xml = await xmlResponse.text();
  if (!xml) throw new Error("Caption URL returned empty response");

  const segments = [];
  const isFormat3 = xml.includes('<p t="');
  const marker = isFormat3 ? "<p " : "<text ";
  const endMarker = isFormat3 ? "</p>" : "</text>";
  const getAttr = (text, name) => {
    const needle = `${name}="`;
    const idx = text.indexOf(needle);
    if (idx === -1) return "";
    const valStart = idx + needle.length;
    const valEnd = text.indexOf('"', valStart);
    if (valEnd === -1) return "";
    return text.slice(valStart, valEnd);
  };

  let pos = 0;
  while (true) {
    const tagStart = xml.indexOf(marker, pos);
    if (tagStart === -1) break;
    let contentStart = xml.indexOf(">", tagStart);
    if (contentStart === -1) break;
    contentStart += 1;
    const tagEnd = xml.indexOf(endMarker, contentStart);
    if (tagEnd === -1) break;

    const attrStr = xml.slice(tagStart + marker.length, contentStart - 1);
    const content = xml.slice(contentStart, tagEnd);
    const startSec = isFormat3 ? (parseFloat(getAttr(attrStr, "t")) || 0) / 1000 : parseFloat(getAttr(attrStr, "start")) || 0;
    const durSec = isFormat3 ? (parseFloat(getAttr(attrStr, "d")) || 0) / 1000 : parseFloat(getAttr(attrStr, "dur")) || 0;
    const text = decodeEntities(content.replace(/<[^>]+>/g, "")).split("\n").join(" ").trim();
    if (text) {
      segments.push({
        start: startSec,
        end: startSec + durSec,
        text,
      });
    }

    pos = tagEnd + endMarker.length;
  }

  if (!segments.length) throw new Error("Parsed 0 segments from caption XML");

  if (mode === "raw") {
    return {
      mode,
      language: track.languageCode || "",
      count: segments.length,
      rows: segments.slice(0, __COUNT__).map((item, index) => ({
        index: index + 1,
        start: `${Number(item.start).toFixed(2)}s`,
        end: `${Number(item.end).toFixed(2)}s`,
        text: item.text,
      })),
    };
  }

  const rows = [];
  let buffer = "";
  let bufferStart = 0;
  const sentenceEnd = /[.!?\u3002\uFF01\uFF1F\uFF0E]["'\u2019\u201D)]*\s*$/;
  const flush = () => {
    if (!buffer.trim()) return;
    rows.push({
      timestamp: fmtTime(bufferStart),
      speaker: "",
      text: buffer.trim(),
    });
    buffer = "";
  };
  for (const seg of segments) {
    if (!buffer) bufferStart = seg.start;
    buffer += (buffer ? " " : "") + seg.text;
    if (sentenceEnd.test(seg.text)) flush();
    if (rows.length >= __COUNT__) break;
  }
  if (rows.length < __COUNT__) flush();

  return {
    mode,
    language: track.languageCode || "",
    count: rows.length,
    rows: rows.slice(0, __COUNT__),
  };
};
