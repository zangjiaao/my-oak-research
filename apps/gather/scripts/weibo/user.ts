/* @meta
{
  "name": "weibo/user",
  "description": "获取 weibo 的 user 数据",
  "domain": "weibo.com",
  "args": {
    "id": {
      "required": true,
      "description": "Script argument: id"
    }
  },
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site weibo/user 1654184992"
}
*/

async () => {
  const userId = String(__WEIBO_ID_JSON__ || "").trim();
  if (!userId) throw new Error("Missing argument: id");

  const isUid = /^\d+$/.test(userId);
  const query = isUid ? `uid=${userId}` : `screen_name=${encodeURIComponent(userId)}`;

  const response = await fetch(`/ajax/profile/info?${query}`, { credentials: "include" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  if (!data?.ok) throw new Error("User not found");

  const user = data?.data?.user;
  if (!user) throw new Error("User not found");

  const detailResp = await fetch(`/ajax/profile/detail?uid=${user?.id || ""}`, { credentials: "include" });
  const detail = detailResp.ok ? await detailResp.json() : null;
  const profile = detail?.data || {};

  return {
    id: user?.id,
    screen_name: user?.screen_name || "",
    description: user?.description || profile?.description || "",
    location: user?.location || "",
    gender: user?.gender === "m" ? "male" : user?.gender === "f" ? "female" : "unknown",
    followers_count: user?.followers_count || 0,
    following_count: user?.friends_count || 0,
    statuses_count: user?.statuses_count || 0,
    verified: Boolean(user?.verified),
    verified_type: user?.verified_type,
    verified_reason: user?.verified_reason || "",
    domain: user?.domain || "",
    url: user?.url || "",
    avatar: user?.avatar_hd || user?.avatar_large || "",
    profile_url: `https://weibo.com${user?.profile_url || `/u/${user?.id || ""}`}`,
    birthday: profile?.birthday || "",
    created_at: profile?.created_at || "",
    ip_location: profile?.ip_location || "",
    company: profile?.company || "",
    credit: profile?.sunshine_credit?.level || "",
    following: Boolean(user?.following),
    follow_me: Boolean(user?.follow_me),
    mbrank: user?.mbrank || 0,
    svip: user?.svip || 0,
  };
};
