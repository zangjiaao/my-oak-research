/* @meta
{
  "name": "hupu/hot",
  "description": "获取 hupu 的 hot 数据",
  "domain": "hupu.com",
  "args": {
    "limit": {
      "required": false,
      "description": "Script argument: limit"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site hupu/hot 20"
}
*/

async () => {
  const count = Math.max(1, Math.min(__COUNT__, 100));
  const response = await fetch("https://bbs.hupu.com/all-gambia");
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = Array.from(doc.querySelectorAll(".list-item-wrap"))
    .map((wrap, index) => {
      const link = wrap.querySelector(".t-info > a");
      const titleEl = wrap.querySelector(".t-title");
      const lightsEl = wrap.querySelector(".t-lights");
      const repliesEl = wrap.querySelector(".t-replies");
      const labelEl = wrap.querySelector(".t-label a");
      if (!link || !titleEl) return null;

      const href = link.getAttribute("href") || "";
      const lights = parseInt(String(lightsEl?.textContent || "").replace(/\D/g, ""), 10) || 0;
      const replies = parseInt(String(repliesEl?.textContent || "").replace(/\D/g, ""), 10) || 0;
      return {
        rank: index + 1,
        tid: href.replace(/\D/g, ""),
        title: String(titleEl.textContent || "").trim(),
        url: `https://bbs.hupu.com${href}`,
        lights,
        replies,
        isHot: String(link.className || "").includes("hot"),
        forum: String(labelEl?.textContent || "").trim(),
      };
    })
    .filter(Boolean)
    .slice(0, count);

  return { count: items.length, items };
};
