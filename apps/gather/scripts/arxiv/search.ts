// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"large language model","limit":10}
// output.field: {"id":"papers.id","title":"papers.title","authors":"papers.authors","url":"papers.url"}

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "query is required" };
  const count = Math.max(1, Math.min(__COUNT__, 50));

  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${count}`;
  const response = await fetch(url);
  if (!response.ok) return { error: `HTTP ${response.status}` };

  const xml = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "text/xml");

  const entries = Array.from(doc.querySelectorAll("entry"));
  const papers = entries.map((entry) => {
    const getText = (tag) => {
      const node = entry.querySelector(tag);
      return node ? String(node.textContent || "").trim() : "";
    };

    const authors = Array.from(entry.querySelectorAll("author > name")).map((node) => String(node.textContent || "").trim());
    const pdfLink = entry.querySelector('link[title="pdf"]')?.getAttribute("href") || "";
    const absLink = entry.querySelector("id")?.textContent?.trim() || "";
    const categories = Array.from(entry.querySelectorAll("category")).map((node) => node.getAttribute("term") || "").filter(Boolean);
    const arxivId = absLink.replace("http://arxiv.org/abs/", "");

    return {
      id: arxivId,
      title: getText("title").replace(/\s+/g, " "),
      abstract: getText("summary").replace(/\s+/g, " ").slice(0, 500),
      authors,
      published: getText("published").slice(0, 10),
      categories,
      url: absLink,
      pdf: pdfLink,
    };
  });

  const totalResults = parseInt(doc.querySelector("totalResults")?.textContent || "0", 10) || 0;
  return { query, totalResults, count: papers.length, papers };
};
