/* @meta
{
  "name": "toutiao/hot",
  "description": "获取 toutiao 的 hot 数据",
  "domain": "toutiao.com",
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
  "example": "bb-browser site toutiao/hot 20",
  "category": "STREAM",
  "auth": {
    "required": false,
    "kind": "toutiao-cookie",
    "description": "toutiao auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const count = Math.max(1, Math.min(__COUNT__, 50));
  const parseItems = (data: any) => {
    const list = data?.data || data?.fixed_top_data || [];
    if (!Array.isArray(list) || list.length === 0) return [];
    return list.slice(0, count).map((item, index) => ({
      rank: index + 1,
      title: item?.Title || item?.title || "",
      hot_value: item?.HotValue || item?.hot_value || 0,
      label: item?.Label || item?.label || "",
      url: item?.Url || item?.url || "",
      cluster_id: item?.ClusterId || item?.cluster_id || "",
    }));
  };

  try {
    const inlineText = (document?.body?.textContent || "").trim();
    if (inlineText.startsWith("{")) {
      const inlineData = JSON.parse(inlineText);
      const inlineItems = parseItems(inlineData);
      if (inlineItems.length > 0) {
        return { count: inlineItems.length, items: inlineItems };
      }
    }
  } catch (_error) {}

  const response = await fetch("https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc", { credentials: "include" });

  if (!response.ok) {
    return { error: `HTTP ${response.status}`, hint: "Open www.toutiao.com first" };
  }

  let data;
  try {
    data = await response.json();
  } catch (_error) {
    return { error: "Invalid hot board response" };
  }

  const items = parseItems(data);
  if (items.length === 0) return { error: "Could not extract hot topics" };

  return { count: items.length, items };
};
