// Sample /v3/fetch key parts
// intent.type: feed
// intent.args: {"limit":20}
// output.field: {"id":"notes.id","title":"notes.title","author":"notes.author","likes":"notes.likes","url":"notes.url"}
async () => {
    const limit = Number(__LIMIT__) || Number(__COUNT__) || 20;
    const captureKey = "homefeed";
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    if (!window.__oakGatherCapture) {
        window.__oakGatherCapture = [];
    }
    const captures = window.__oakGatherCapture;
    const pushCapture = (url, payload) => {
        if (!url || !String(url).includes(captureKey))
            return;
        if (!payload || typeof payload !== "object")
            return;
        captures.push(payload);
    };
    if (!window.__oakXhsFeedHooked) {
        window.__oakXhsFeedHooked = true;
        const originalFetch = window.fetch.bind(window);
        window.fetch = async (...fetchArgs) => {
            const response = await originalFetch(...fetchArgs);
            try {
                const reqLike = fetchArgs[0];
                let reqUrl = "";
                if (typeof reqLike === "string") {
                    reqUrl = reqLike;
                }
                else if (reqLike && typeof reqLike === "object" && "url" in reqLike) {
                    const possibleUrl = Reflect.get(reqLike, "url");
                    reqUrl = typeof possibleUrl === "string" ? possibleUrl : "";
                }
                if (reqUrl.includes(captureKey)) {
                    const cloned = response.clone();
                    pushCapture(reqUrl, await cloned.json());
                }
            }
            catch (_error) { }
            return response;
        };
    }
    for (let i = 0; i < Math.max(1, Number(__SCROLL_TIMES__) || 3); i += 1) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1000);
    }
    if (!captures.length) {
        await sleep(1200);
    }
    const notes = [];
    const seen = new Set();
    for (const payload of captures) {
        const items = payload?.data?.items || [];
        for (const item of items) {
            const card = item?.note_card || {};
            const noteId = item?.id || card?.note_id || card?.id;
            if (!noteId || seen.has(noteId))
                continue;
            seen.add(noteId);
            notes.push({
                id: noteId,
                title: card?.display_title || "",
                type: card?.type || "",
                author: card?.user?.nickname || "",
                likes: card?.interact_info?.liked_count || 0,
                url: `https://www.xiaohongshu.com/explore/${noteId}`,
            });
        }
    }
    if (!notes.length) {
        const cards = Array.from(document.querySelectorAll("section.note-item"));
        for (const el of cards) {
            if (!(el instanceof HTMLElement))
                continue;
            const link = el.querySelector('a[href*="/explore/"],a[href*="/note/"]');
            const href = link ? link.getAttribute("href") || "" : "";
            const matched = href.match(/\/(?:explore|note)\/([A-Za-z0-9]+)/);
            const noteId = matched ? matched[1] : "";
            if (!noteId || seen.has(noteId))
                continue;
            seen.add(noteId);
            const titleEl = el.querySelector(".title,.note-title,a.title");
            const authorEl = el.querySelector(".name,.author-name,.nick-name");
            const likesEl = el.querySelector(".count,.like-count,.like-wrapper .count");
            notes.push({
                id: noteId,
                title: (titleEl && titleEl.textContent ? titleEl.textContent : "").trim(),
                type: "",
                author: (authorEl && authorEl.textContent ? authorEl.textContent : "").trim(),
                likes: (likesEl && likesEl.textContent ? likesEl.textContent : "0").trim(),
                url: `https://www.xiaohongshu.com/explore/${noteId}`,
            });
        }
    }
    return {
        count: notes.length,
        notes: notes.slice(0, Math.max(1, limit)),
    };
};
