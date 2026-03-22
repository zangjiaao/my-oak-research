// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"ai","limit":20}
// output.field: {"id":"notes.id","title":"notes.title","author":"notes.author","likes":"notes.likes","url":"notes.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "xiaohongshu-cookie"
// auth.description: "xiaohongshu auth credential"
// tags: ["domestic"]

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
