/* @meta
{
  "name": "xiaohongshu/notifications",
  "description": "获取 xiaohongshu 的 notifications 数据",
  "domain": "xiaohongshu.com",
  "args": {
    "type": {
      "required": true,
      "description": "Script argument: type"
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
  "example": "bb-browser site xiaohongshu/notifications mentions 20",
  "category": "INTERACTIVE",
  "auth": {
    "required": true,
    "kind": "xiaohongshu-cookie",
    "description": "xiaohongshu auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const category = String(__NOTIFICATION_TYPE_JSON__ || "mentions").trim() || "mentions";
  const limit = Number(__LIMIT__) || Number(__COUNT__) || 20;
  const captureKey = "/you/";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  if (!window.__oakGatherCapture) {
    window.__oakGatherCapture = [];
  }
  const captures = window.__oakGatherCapture;

  const pushCapture = (url, payload) => {
    if (!url || !String(url).includes(captureKey)) return;
    if (!payload || typeof payload !== "object") return;
    captures.push(payload);
  };

  if (!window.__oakXhsNotificationHooked) {
    window.__oakXhsNotificationHooked = true;
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
  }

  for (let i = 0; i < 2; i += 1) {
    window.scrollTo(0, document.body.scrollHeight);
    await sleep(1000);
  }

  const messages = [];
  for (const payload of captures) {
    const rows = payload?.data?.message_list || [];
    for (const row of rows) {
      messages.push({
        type: category,
        user: row?.user_info?.nickname || "",
        action: row?.title || "",
        content: row?.comment_info?.content || "",
        note: row?.item_info?.content || "",
        time: row?.time || null,
      });
    }
  }

  return {
    type: category,
    count: messages.length,
    messages: messages.slice(0, Math.max(1, limit)),
  };
};
