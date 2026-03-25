/* @meta
{
  "name": "bilibili/me",
  "description": "获取 bilibili 的 me 数据",
  "domain": "bilibili.com",
  "args": {},
  "capabilities": [
    "network"
  ],
  "readOnly": true,
  "example": "bb-browser site bilibili/me"
}
*/

async () => {
  const response = await fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" });
  if (!response.ok) return { error: `HTTP ${response.status}`, hint: "Not logged in?" };
  const payload = await response.json();
  if (payload?.code !== 0) return { error: payload?.message || `API error ${payload?.code}`, hint: "Not logged in?" };
  if (!payload?.data?.isLogin) return { error: "Not logged in", hint: "Please log in to bilibili.com first" };

  const user = payload.data;
  const result: any = {
    mid: user?.mid || null,
    username: user?.uname || "",
    url: user?.mid ? `https://space.bilibili.com/${user.mid}` : "https://www.bilibili.com",
    face: user?.face || "",
    level: user?.level_info?.current_level || 0,
    coins: user?.money || 0,
    vip: user?.vipType > 0,
    vip_type: user?.vipType === 1 ? "monthly" : user?.vipType === 2 ? "annual" : "none",
    vip_label: user?.vip_label?.text || null,
    moral: user?.moral || 0,
    email_verified: user?.email_verified === 1,
    tel_verified: user?.mobile_verified === 1,
    follower: null,
    following: null,
  };

  try {
    const statResponse = await fetch("https://api.bilibili.com/x/web-interface/nav/stat", { credentials: "include" });
    const statPayload = await statResponse.json();
    if (statPayload?.code === 0 && statPayload?.data) {
      result.follower = statPayload.data.follower;
      result.following = statPayload.data.following;
    }
  } catch (_error) {}

  return result;
};
