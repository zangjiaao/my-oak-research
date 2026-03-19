// Sample /v3/fetch key parts
// intent.type: hot
// intent.args: {"limit":20}
// output.field: {"rank":"items.rank","title":"items.title","hot_value":"items.hot_value","url":"items.url"}

async () => {
  const count = Math.max(1, Math.min(__COUNT__, 50));
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

  const list = data?.data || data?.fixed_top_data || [];
  if (!Array.isArray(list) || list.length === 0) return { error: "Could not extract hot topics" };

  const items = list.slice(0, count).map((item, index) => ({
    rank: index + 1,
    title: item?.Title || item?.title || "",
    hot_value: item?.HotValue || item?.hot_value || 0,
    label: item?.Label || item?.label || "",
    url: item?.Url || item?.url || "",
    cluster_id: item?.ClusterId || item?.cluster_id || "",
  }));

  return { count: items.length, items };
};
