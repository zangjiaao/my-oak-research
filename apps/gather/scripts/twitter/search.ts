// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"openai","limit":20}
// output.field: {"id":"tweets.id","text":"tweets.text","author":"tweets.author","url":"tweets.url","created_at":"tweets.created_at"}

  const CAPTURE_KEY = "SearchTimeline";
  if (!window.__oakGatherCapture) {
    window.__oakGatherCapture = [];
    const pushCapture = (url, payload) => {
      if (!url || !String(url).includes(CAPTURE_KEY)) return;
      if (!payload || typeof payload !== "object") return;
      window.__oakGatherCapture.push(payload);
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...fetchArgs) => {
      const response = await origFetch(...fetchArgs);
      try {
        const reqUrl =
          typeof fetchArgs[0] === "string"
            ? fetchArgs[0]
            : (fetchArgs[0] && fetchArgs[0].url) || "";
        if (reqUrl.includes(CAPTURE_KEY)) {
          const cloned = response.clone();
          const data = await cloned.json();
          pushCapture(reqUrl, data);
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
      if (this.__oakGatherUrl && this.__oakGatherUrl.includes(CAPTURE_KEY)) {
        this.addEventListener("load", function () {
          try {
            const payload = JSON.parse(this.responseText);
            pushCapture(this.__oakGatherUrl, payload);
          } catch (_error) {}
        });
      }
      return xhrSend.apply(this, arguments);
    };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < __SCROLL_TIMES__; i += 1) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
  }

  const captures = Array.isArray(window.__oakGatherCapture) ? window.__oakGatherCapture : [];
  const tweets = [];
  const seen = new Set();

  for (const payload of captures) {
    const instructions = payload?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    for (const inst of instructions) {
      const entries = inst?.entries || [];
      for (const entry of entries) {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        if (!result) continue;
        const tweet = result.tweet || result;
        const legacy = tweet?.legacy || {};
        const restId = tweet?.rest_id;
        if (!restId || seen.has(restId)) continue;
        seen.add(restId);
        const user = tweet?.core?.user_results?.result;
        const screenName = user?.legacy?.screen_name || user?.core?.screen_name || "unknown";
        const noteText = tweet?.note_tweet?.note_tweet_results?.result?.text;
        tweets.push({
          id: restId,
          author: screenName,
          name: user?.legacy?.name || user?.core?.name || "",
          url: `https://x.com/${screenName}/status/${restId}`,
          text: noteText || legacy.full_text || "",
          created_at: legacy.created_at || null,
        });
      }
    }
  }

  return {
    query: __QUERY_JSON__,
    product: __PRODUCT_JSON__,
    count: tweets.length,
    tweets: tweets.slice(0, __COUNT__),
  };
};
