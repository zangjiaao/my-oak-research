/* @meta
{
  "name": "linux-do/categories",
  "description": "获取 linux-do 的 categories 数据",
  "domain": "linux.do",
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
  "example": "bb-browser site linux-do/categories 20"
}
*/

async () => {
  const response = await fetch("/categories.json", { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status} - 请先登录 linux.do`);
  let data;
  try {
    data = await response.json();
  } catch (_error) {
    throw new Error("响应不是有效 JSON - 请先登录 linux.do");
  }
  const categories = Array.isArray(data?.category_list?.categories) ? data.category_list.categories : [];
  return {
    count: categories.length,
    categories: categories.slice(0, __COUNT__).map((category) => ({
      name: category?.name || "",
      slug: category?.slug || "",
      id: category?.id || 0,
      topics: category?.topic_count || 0,
      description: String(category?.description_text || "").slice(0, 80),
    })),
  };
};
