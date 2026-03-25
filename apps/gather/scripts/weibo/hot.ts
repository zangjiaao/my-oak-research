/* @meta
{
  "name": "weibo/hot",
  "description": "获取 weibo 的 hot 数据",
  "domain": "weibo.com",
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
  "example": "bb-browser site weibo/hot 30",
  "category": "INTERACTIVE",
  "auth": {
    "required": true,
    "kind": "weibo-cookie",
    "description": "weibo auth credential"
  },
  "tags": [
    "domestic"
  ]
}
*/

async () => {
  const response = await fetch("/ajax/statuses/hot_band", { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  if (!data?.ok) throw new Error("API error");

  const bandList = data?.data?.band_list || [];
  const items = bandList.slice(0, __COUNT__).map((item, index) => ({
    rank: item?.realpos || index + 1,
    word: item?.word || "",
    hot_value: item?.num || 0,
    raw_hot: item?.raw_hot || 0,
    category: item?.category || "",
    label: item?.label_name || "",
    is_new: Boolean(item?.is_new),
    url: `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${item?.word || ""}#`)}`,
  }));

  const hotgov = data?.data?.hotgov;
  const top = hotgov
    ? {
      word: hotgov?.word || hotgov?.name || "",
      url: hotgov?.url || "",
    }
    : null;

  return { count: items.length, top, items };
};
