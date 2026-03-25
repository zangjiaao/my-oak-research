// Sample /v1/fetch key parts
// intent.type: user
// intent.args: {"id":"66f26918000000000101adf0","limit":20}
// output.field: {"id":"notes.id","title":"notes.title","type":"notes.type","likes":"notes.likes","url":"notes.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "xiaohongshu-cookie"
// auth.description: "xiaohongshu auth credential"
// tags: ["domestic"]

async () => {
  const userId = String(__XHS_USER_ID_JSON__ || "").trim();
  const limit = Number(__LIMIT__) || Number(__COUNT__) || 20;
  const captureKey = "v1/user/posted";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (!userId) {
    return { error: "id is required", notes: [] };
  }

  if (!window.__oakGatherCapture) {
    window.__oakGatherCapture = [];
  }
  const captures = window.__oakGatherCapture;

  const pushCapture = (url, payload) => {
    if (!url || !String(url).includes(captureKey)) return;
    if (!payload || typeof payload !== "object") return;
    captures.push(payload);
  };

  if (!window.__oakXhsPostedHooked) {
    window.__oakXhsPostedHooked = true;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...fetchArgs) => {
      const response = await originalFetch(...fetchArgs);
      try {
        const reqLike = fetchArgs[0];
        let reqUrl = "";
        if (typeof reqLike === "string") {
          reqUrl = reqLike;
        } else if (reqLike && typeof reqLike === "object" && "url" in reqLike) {
          const possibleUrl = Reflect.get(reqLike, "url");
          reqUrl = typeof possibleUrl === "string" ? possibleUrl : "";
        }
        if (reqUrl.includes(captureKey)) {
          const cloned = response.clone();
          pushCapture(reqUrl, await cloned.json());
        }
      } catch (_error) {}
      return response;
    };

    const xhrOpen = XMLHttpRequest.prototype.open;
    const xhrSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__oakGatherUrl = String(url || "");
      return xhrOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function () {
      if (this.__oakGatherUrl && this.__oakGatherUrl.includes(captureKey)) {
        this.addEventListener("load", function () {
          try {
            pushCapture(this.__oakGatherUrl, JSON.parse(this.responseText));
          } catch (_error) {}
        });
      }
      return xhrSend.apply(this, arguments);
    };
  }

  for (let i = 0; i < Math.max(1, Number(__SCROLL_TIMES__) || 3); i += 1) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(2000);
  }

  if (!captures.length) {
    await sleep(1800);
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1600);
  }

  const notes = [];
  const seen = new Set();
  for (const payload of captures) {
    const rawNotes = payload?.data?.notes || [];
    for (const note of rawNotes) {
      const noteId = note?.note_id || note?.id;
      if (!noteId || seen.has(noteId)) continue;
      seen.add(noteId);
      notes.push({
        id: noteId,
        title: note?.display_title || "",
        type: note?.type || "",
        likes: note?.interact_info?.liked_count || 0,
        url: `https://www.xiaohongshu.com/explore/${noteId}`,
      });
    }
  }

  if (!notes.length) {
    const cards = Array.from(document.querySelectorAll("section.note-item"));
    for (const el of cards) {
      if (!(el instanceof HTMLElement)) continue;
      const link = el.querySelector('a[href*="/explore/"],a[href*="/note/"]');
      const href = link ? link.getAttribute("href") || "" : "";
      const matched = href.match(/\/(?:explore|note)\/([A-Za-z0-9]+)/);
      const noteId = matched ? matched[1] : "";
      if (!noteId || seen.has(noteId)) continue;
      seen.add(noteId);
      const titleEl = el.querySelector(".title,.note-title,a.title");
      notes.push({
        id: noteId,
        title: (titleEl && titleEl.textContent ? titleEl.textContent : "").trim(),
        type: "",
        likes: 0,
        url: `https://www.xiaohongshu.com/explore/${noteId}`,
      });
    }
  }

  return {
    id: userId,
    count: notes.length,
    notes: notes.slice(0, Math.max(1, limit)),
  };
};
