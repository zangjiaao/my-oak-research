// Sample /v3/fetch key parts
// intent.type: notifications
// intent.args: {"limit":20}
// output.field: {"id":"notifications.id","action":"notifications.action","text":"notifications.text","author":"notifications.author","url":"notifications.url"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "twitter-cookie"
// auth.description: "twitter auth credential"
// tags: ["foreign"]

async () => {
  const limit = Number(__COUNT__) || 20;
  const CAPTURE_KEY = 'NotificationsTimeline';
  if (!window.__oakGatherCapture) {
    window.__oakGatherCapture = [];
    const pushCapture = (url, payload) => {
      if (!url || !String(url).includes(CAPTURE_KEY)) return;
      if (!payload || typeof payload !== 'object') return;
      window.__oakGatherCapture.push(payload);
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...fetchArgs) => {
      const response = await origFetch(...fetchArgs);
      try {
        const requestLike = fetchArgs[0] as { url?: string } | string | undefined;
        const reqUrl = typeof requestLike === 'string' ? requestLike : requestLike?.url || '';
        if (reqUrl.includes(CAPTURE_KEY)) {
          const cloned = response.clone();
          pushCapture(reqUrl, await cloned.json());
        }
      } catch (_error) {}
      return response;
    };
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let i = 0; i < __SCROLL_TIMES__; i += 1) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1200);
  }

  const items = [];
  const seen = new Set();
  const captures = Array.isArray(window.__oakGatherCapture) ? window.__oakGatherCapture : [];
  for (const payload of captures) {
    const instructions = payload?.data?.viewer?.timeline_response?.timeline?.instructions
      || payload?.data?.viewer_v2?.user_results?.result?.notification_timeline?.timeline?.instructions
      || payload?.data?.timeline?.instructions
      || [];
    for (const inst of instructions) {
      for (const entry of inst?.entries || []) {
        const content = entry?.content?.itemContent;
        const result = content?.notification_results?.result || content?.tweet_results?.result;
        if (!result) continue;
        const id = result?.id || result?.rest_id || entry?.entryId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const tweet = result?.tweet_result?.result || result;
        const screenName = tweet?.core?.user_results?.result?.legacy?.screen_name || 'unknown';
        const text = tweet?.note_tweet?.note_tweet_results?.result?.text || tweet?.legacy?.full_text || result?.rich_message?.text || '';
        items.push({
          id,
          action: result?.notification_icon || 'Notification',
          author: screenName,
          text,
          url: tweet?.rest_id ? `https://x.com/${screenName}/status/${tweet.rest_id}` : 'https://x.com/notifications',
        });
      }
    }
  }

  return { count: items.length, notifications: items.slice(0, limit) };
};
