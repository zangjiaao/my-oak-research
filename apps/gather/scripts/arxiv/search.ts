// Sample /v3/fetch key parts
// intent.type: search
// intent.args: {"query":"large language model","limit":10}
// output.field: {"id":"papers.id","title":"papers.title","authors":"papers.authors","url":"papers.url"}

async () => {
  const query = String(__QUERY_JSON__ || "").trim();
  if (!query) return { error: "query is required" };
  const count = Math.max(1, Math.min(__COUNT__, 50));

  const parseXmlResult = (xmlText: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");
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
    const totalResults = parseInt(doc.querySelector("totalResults")?.textContent || "0", 10) || papers.length;
    return { papers, totalResults };
  };

  const parseDoc = (doc: Document) => {
    const papers = Array.from(doc.querySelectorAll("li.arxiv-result")).slice(0, count).map((item) => {
      const title = String(item.querySelector("p.title")?.textContent || "").replace(/\s+/g, " ").trim();
      const abstract = String(item.querySelector("span.abstract-full")?.textContent || "")
        .replace(/^Abstract:\s*/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 500);
      const authors = Array.from(item.querySelectorAll("p.authors a")).map((a) => String(a.textContent || "").trim()).filter(Boolean);
      const absUrl = item.querySelector("p.list-title a")?.getAttribute("href") || "";
      const pdfUrl = item.querySelector('a[title="Download PDF"]')?.getAttribute("href") || "";
      const publishedLine = String(item.querySelector("p.is-size-7")?.textContent || "");
      const publishedMatch = publishedLine.match(/Submitted\s+(\d+\s+\w+\s+\d{4})/i);
      const categories = String(item.querySelector("span.tag.is-small")?.textContent || "")
        .split(";")
        .map((v) => v.trim())
        .filter(Boolean);
      const idMatch = absUrl.match(/\/abs\/([^/?#]+)/);
      return {
        id: idMatch ? idMatch[1] : "",
        title,
        abstract,
        authors,
        published: publishedMatch ? publishedMatch[1] : "",
        categories,
        url: absUrl,
        pdf: pdfUrl,
      };
    });

    const totalText = String(doc.querySelector("h1.title")?.textContent || "");
    const totalMatch = totalText.match(/of\s+([\d,]+)\s+results/i);
    const totalResults = totalMatch ? parseInt(totalMatch[1].replace(/,/g, ""), 10) || 0 : papers.length;
    return { papers, totalResults };
  };

  try {
    const apiUrl = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${count}`;
    const apiResponse = await fetch(apiUrl);
    if (apiResponse.ok) {
      const xml = await apiResponse.text();
      const { papers, totalResults } = parseXmlResult(xml);
      if (papers.length > 0) {
        return { query, totalResults, count: papers.length, papers, source: "api" };
      }
    }
  } catch (_error) {}

  let parsed = parseDoc(document);
  if (parsed.papers.length === 0) {
    const url = `https://arxiv.org/search/?query=${encodeURIComponent(query)}&searchtype=all&source=header&size=${count}`;
    const response = await fetch(url, { credentials: "include" });
    if (response.ok) {
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, "text/html");
      parsed = parseDoc(doc);
    } else {
      return { query, totalResults: 0, count: 0, papers: [], source: "html", hint: `fallback fetch status ${response.status}` };
    }
  }

  const { papers, totalResults } = parsed;
  return { query, totalResults, count: papers.length, papers, source: "html" };
};
