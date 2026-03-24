// Sample /v1/fetch key parts
// intent.type: following
// intent.args: {"username":"openai","limit":50}
// output.field: {"screen_name":"users.screen_name","name":"users.name","bio":"users.bio","followers":"users.followers","url":"users.url"}
async () => {
    const username = String(__USERNAME_JSON__ || '').replace(/^@/, '').trim();
    const limit = Number(__COUNT__) || 50;
    if (!username) {
        return { error: 'username is required' };
    }
    const CAPTURE_KEY = 'Following';
    if (!window.__oakGatherCapture) {
        window.__oakGatherCapture = [];
        const pushCapture = (url, payload) => {
            if (!url || !String(url).includes(CAPTURE_KEY))
                return;
            if (!payload || typeof payload !== 'object')
                return;
            window.__oakGatherCapture.push(payload);
        };
        const origFetch = window.fetch.bind(window);
        window.fetch = async (...fetchArgs) => {
            const response = await origFetch(...fetchArgs);
            try {
                const requestLike = fetchArgs[0];
                const reqUrl = typeof requestLike === 'string'
                    ? requestLike
                    : requestLike && typeof requestLike.url === 'string'
                        ? requestLike.url
                        : '';
                if (reqUrl.includes(CAPTURE_KEY)) {
                    const cloned = response.clone();
                    pushCapture(reqUrl, await cloned.json());
                }
            }
            catch (_error) { }
            return response;
        };
    }
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    await sleep(1800);
    for (let i = 0; i < __SCROLL_TIMES__; i += 1) {
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(1200);
    }
    const users = [];
    const seen = new Set();
    const captures = Array.isArray(window.__oakGatherCapture) ? window.__oakGatherCapture : [];
    for (const payload of captures) {
        const instructions = payload?.data?.user?.result?.timeline?.timeline?.instructions || [];
        for (const inst of instructions) {
            for (const entry of inst?.entries || []) {
                const user = entry?.content?.itemContent?.user_results?.result;
                const legacy = user?.legacy || {};
                const core = user?.core || {};
                const screenName = core.screen_name || legacy.screen_name;
                if (!screenName || seen.has(screenName))
                    continue;
                seen.add(screenName);
                users.push({
                    screen_name: screenName,
                    name: core.name || legacy.name || '',
                    bio: legacy.description || '',
                    followers: legacy.followers_count || legacy.normal_followers_count || 0,
                    url: `https://x.com/${screenName}`,
                });
            }
        }
    }
    return { count: users.length, users: users.slice(0, limit) };
};
