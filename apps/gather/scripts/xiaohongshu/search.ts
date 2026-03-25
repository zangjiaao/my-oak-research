/* @meta
{
  "name": "xiaohongshu/search",
  "description": "获取 xiaohongshu 的 search 数据",
  "domain": "xiaohongshu.com",
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
  "example": "bb-browser site xiaohongshu/search ai 20"
}
*/

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  const limit = Number(__LIMIT__) || Number(__COUNT__) || 20;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (!query) {
    return { error: "query is required", notes: [] };
  }

  for (let i = 0; i < Math.max(1, Number(__SCROLL_TIMES__) || 2); i += 1) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(900);
  }

  const cards = Array.from(document.querySelectorAll("section.note-item"));
  const notes = [];
  const seen = new Set();

  for (const el of cards) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.classList.contains("query-note-item")) continue;

    const link = el.querySelector('a[href*="/explore/"],a[href*="/note/"]');
    const href = link ? link.getAttribute("href") || "" : "";
    const matched = href.match(/\/(?:explore|note)\/([A-Za-z0-9]+)/);
    const noteId = matched ? matched[1] : "";
    if (!noteId || seen.has(noteId)) continue;
    seen.add(noteId);

    const titleEl = el.querySelector(".title,.note-title,a.title");
    const authorEl = el.querySelector(".name,.author-name,.nick-name");
    const likesEl = el.querySelector(".count,.like-count,.like-wrapper .count");

    notes.push({
      id: noteId,
      title: (titleEl && titleEl.textContent ? titleEl.textContent : "").trim(),
      author: (authorEl && authorEl.textContent ? authorEl.textContent : "").trim(),
      likes: (likesEl && likesEl.textContent ? likesEl.textContent : "0").trim(),
      url: `https://www.xiaohongshu.com/explore/${noteId}`,
    });
  }

  return {
    query,
    count: notes.length,
    notes: notes.slice(0, Math.max(1, limit)),
  };
};
