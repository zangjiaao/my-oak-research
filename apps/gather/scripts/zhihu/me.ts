// Sample /v1/fetch key parts
// intent.type: me
// intent.args: {}
// output.field: {"name":"name","url":"url","headline":"headline","answer_count":"answer_count"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "zhihu-cookie"
// auth.description: "zhihu auth credential"
// tags: ["domestic"]

async () => {
  const response = await fetch("https://www.zhihu.com/api/v4/me", { credentials: "include" });
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  }

  const user = await response.json();
  const urlToken = user?.url_token || "";

  return {
    id: user?.id || "",
    uid: user?.uid || "",
    name: user?.name || "",
    url: urlToken ? `https://www.zhihu.com/people/${urlToken}` : "https://www.zhihu.com",
    url_token: urlToken,
    headline: user?.headline || "",
    gender: user?.gender === 1 ? "male" : user?.gender === 0 ? "female" : "unknown",
    ip_info: user?.ip_info || "",
    avatar_url: user?.avatar_url || "",
    is_vip: Boolean(user?.vip_info?.is_vip),
    answer_count: user?.answer_count || 0,
    question_count: user?.question_count || 0,
    articles_count: user?.articles_count || 0,
    columns_count: user?.columns_count || 0,
    favorite_count: user?.favorite_count || 0,
    voteup_count: user?.voteup_count || 0,
    thanked_count: user?.thanked_count || 0,
    creation_count: user?.creation_count || 0,
    notifications: {
      default: user?.default_notifications_count || 0,
      follow: user?.follow_notifications_count || 0,
      vote_thank: user?.vote_thank_notifications_count || 0,
      messages: user?.messages_count || 0,
    },
  };
};
