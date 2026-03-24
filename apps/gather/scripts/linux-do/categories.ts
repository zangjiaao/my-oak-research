// Sample /v1/fetch key parts
// intent.type: categories
// intent.args: {"limit":20}
// output.field: {"name":"categories.name","slug":"categories.slug","id":"categories.id","topics":"categories.topics","description":"categories.description"}
// category: "INTERACTIVE"
// auth.required: false
// auth.kind: "linux-do-cookie"
// auth.description: "linux-do auth credential"
// tags: ["domestic"]

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
