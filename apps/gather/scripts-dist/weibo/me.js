// Sample /v1/fetch key parts
// intent.type: me
// intent.args: {}
// output.field: {"id":"id","screen_name":"screen_name","followers_count":"followers_count","profile_url":"profile_url"}
async () => {
    const app = document.querySelector("#app")?.__vue_app__;
    const store = app?.config?.globalProperties?.$store;
    const cfg = store?.state?.config?.config;
    if (cfg?.user && cfg?.uid) {
        const user = cfg.user;
        const detail = await fetch(`/ajax/profile/detail?uid=${cfg.uid}`, { credentials: "include" })
            .then((resp) => (resp.ok ? resp.json() : null))
            .catch(() => null);
        const data = detail?.data || {};
        return {
            id: user?.id,
            screen_name: user?.screen_name || "",
            description: user?.description || data?.description || "",
            location: user?.location || "",
            gender: user?.gender === "m" ? "male" : user?.gender === "f" ? "female" : "unknown",
            followers_count: user?.followers_count || 0,
            following_count: user?.friends_count || 0,
            statuses_count: user?.statuses_count || 0,
            verified: Boolean(user?.verified),
            domain: user?.domain || "",
            url: user?.url || "",
            avatar: user?.avatar_hd || user?.avatar_large || "",
            profile_url: `https://weibo.com${user?.profile_url || `/u/${user?.id || ""}`}`,
            birthday: data?.birthday || "",
            created_at: data?.created_at || "",
            ip_location: data?.ip_location || "",
            company: data?.company || "",
            credit: data?.sunshine_credit?.level || "",
        };
    }
    const response = await fetch("/ajax/config/get_config", { credentials: "include" });
    if (!response.ok)
        throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!data?.ok || !data?.data?.uid)
        throw new Error("Not logged in");
    throw new Error("User data not available from config");
};
