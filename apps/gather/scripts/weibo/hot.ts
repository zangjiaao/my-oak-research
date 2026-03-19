// Sample /v3/fetch key parts
// intent.type: hot
// intent.args: {"limit":30}
// output.field: {"rank":"items.rank","word":"items.word","hot_value":"items.hot_value","url":"items.url"}

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
