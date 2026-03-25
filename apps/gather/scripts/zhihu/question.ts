/* @meta
{
  "name": "zhihu/question",
  "description": "获取 zhihu 的 question 数据",
  "domain": "zhihu.com",
  "args": {
    "id": {
      "required": true,
      "description": "Script argument: id"
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
  "example": "bb-browser site zhihu/question 34816524 5"
}
*/

async () => {
  const questionId = String(__QUESTION_ID_JSON__ || "").trim();
  if (!questionId) {
    return { error: "Missing argument: id" };
  }

  const count = Math.max(1, Math.min(__COUNT__, 20));
  const [questionResponse, answersResponse] = await Promise.all([
    fetch(
      `https://www.zhihu.com/api/v4/questions/${encodeURIComponent(questionId)}?include=data[*].detail,excerpt,answer_count,follower_count,visit_count,comment_count,topics`,
      { credentials: "include" },
    ),
    fetch(
      `https://www.zhihu.com/api/v4/questions/${encodeURIComponent(questionId)}/answers?limit=${count}&offset=0&sort_by=default&include=data[*].content,voteup_count,comment_count,author`,
      { credentials: "include" },
    ),
  ]);

  if (!questionResponse.ok) {
    return {
      error: `HTTP ${questionResponse.status} fetching question`,
      hint: questionResponse.status === 404 ? "Question not found" : "Not logged in?",
    };
  }
  if (!answersResponse.ok) {
    return { error: `HTTP ${answersResponse.status} fetching answers`, hint: "Not logged in?" };
  }

  const question = await questionResponse.json();
  const answersPayload = await answersResponse.json();

  const strip = (html) => String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  const answers = (answersPayload?.data || []).map((answer, index) => ({
    rank: index + 1,
    id: answer?.id || "",
    author: answer?.author?.name || "anonymous",
    author_headline: answer?.author?.headline || "",
    voteup_count: answer?.voteup_count || 0,
    comment_count: answer?.comment_count || 0,
    content: strip(answer?.content || "").slice(0, 800),
    created_time: answer?.created_time || null,
    updated_time: answer?.updated_time || null,
  }));

  return {
    id: question?.id || questionId,
    title: question?.title || "",
    url: `https://www.zhihu.com/question/${questionId}`,
    detail: strip(question?.detail || ""),
    excerpt: question?.excerpt || "",
    answer_count: question?.answer_count || 0,
    follower_count: question?.follower_count || 0,
    visit_count: question?.visit_count || 0,
    comment_count: question?.comment_count || 0,
    topics: (question?.topics || []).map((topic) => topic?.name).filter(Boolean),
    answers_total: answersPayload?.paging?.totals || answers.length,
    answers,
  };
};
