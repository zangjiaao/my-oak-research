// Sample /v1/fetch key parts
// intent.type: article
// intent.args: {"tweet_id":"1900000000000000000"}
// output.field: {"id":"items.id","title":"items.title","content":"items.content","author":"items.author","url":"items.url"}
async () => {
    const tweetId = String(__TWEET_ID_JSON__ || '').trim();
    if (!tweetId) {
        return { error: 'tweet_id is required' };
    }
    const ct0 = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ct0='))?.split('=')[1];
    if (!ct0) {
        return { error: 'No ct0 cookie - not logged into x.com' };
    }
    const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
    const headers = {
        Authorization: `Bearer ${decodeURIComponent(bearer)}`,
        'X-Csrf-Token': ct0,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Twitter-Active-User': 'yes',
    };
    const variables = JSON.stringify({
        tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false,
    });
    const features = JSON.stringify({
        longform_notetweets_consumption_enabled: true,
        responsive_web_twitter_article_tweet_consumption_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: true,
        articles_preview_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
    });
    const fieldToggles = JSON.stringify({
        withArticleRichContentState: true,
        withArticlePlainText: true,
    });
    async function resolveQueryId(operationName, fallbackId) {
        try {
            const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
            if (ghResp.ok) {
                const data = await ghResp.json();
                const entry = data[operationName];
                if (entry && entry.queryId)
                    return entry.queryId;
            }
        }
        catch (_error) { }
        try {
            const scripts = performance.getEntriesByType('resource')
                .filter((r) => r.name.includes('client-web') && r.name.endsWith('.js'))
                .map((r) => r.name);
            for (const scriptUrl of scripts.slice(0, 15)) {
                try {
                    const text = await (await fetch(scriptUrl)).text();
                    const re = new RegExp(`queryId:"([A-Za-z0-9_-]+)"[^}]{0,200}operationName:"${operationName}"`);
                    const matched = text.match(re);
                    if (matched)
                        return matched[1];
                }
                catch (_error) { }
            }
        }
        catch (_error) { }
        return fallbackId;
    }
    const queryId = await resolveQueryId('TweetResultByRestId', '7xflPyRiUxGVbJd4uWmbfg');
    const apiUrl = `/i/api/graphql/${queryId}/TweetResultByRestId?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}&fieldToggles=${encodeURIComponent(fieldToggles)}`;
    const response = await fetch(apiUrl, { headers, credentials: 'include' });
    if (!response.ok) {
        return { error: `HTTP ${response.status}`, hint: 'Tweet may not exist or queryId expired' };
    }
    const payload = await response.json();
    const result = payload?.data?.tweetResult?.result;
    const tweet = result?.tweet || result;
    if (!tweet) {
        return { error: 'Article not found' };
    }
    const legacy = tweet?.legacy || {};
    const user = tweet?.core?.user_results?.result;
    const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';
    const article = tweet?.article?.article_results?.result;
    if (!article) {
        const noteText = tweet?.note_tweet?.note_tweet_results?.result?.text;
        if (noteText) {
            return {
                tweet_id: tweetId,
                items: [
                    {
                        id: tweet?.rest_id || tweetId,
                        author: screenName,
                        title: '(Note Tweet)',
                        content: noteText,
                        url: `https://x.com/${screenName}/status/${tweet?.rest_id || tweetId}`,
                    },
                ],
            };
        }
        return { error: `Tweet ${tweetId} has no article content` };
    }
    const blocks = article?.content_state?.blocks || [];
    const parts = [];
    let orderedCounter = 0;
    for (const block of blocks) {
        const blockType = block?.type || 'unstyled';
        if (blockType === 'atomic')
            continue;
        const text = block?.text || '';
        if (!text)
            continue;
        if (blockType !== 'ordered-list-item')
            orderedCounter = 0;
        if (blockType === 'header-one')
            parts.push(`# ${text}`);
        else if (blockType === 'header-two')
            parts.push(`## ${text}`);
        else if (blockType === 'header-three')
            parts.push(`### ${text}`);
        else if (blockType === 'blockquote')
            parts.push(`> ${text}`);
        else if (blockType === 'unordered-list-item')
            parts.push(`- ${text}`);
        else if (blockType === 'ordered-list-item') {
            orderedCounter += 1;
            parts.push(`${orderedCounter}. ${text}`);
        }
        else if (blockType === 'code-block')
            parts.push(`\`\`\`\n${text}\n\`\`\``);
        else
            parts.push(text);
    }
    return {
        tweet_id: tweetId,
        items: [
            {
                id: tweet?.rest_id || tweetId,
                author: screenName,
                title: article?.title || '(Untitled)',
                content: parts.join('\n\n') || legacy.full_text || '',
                url: `https://x.com/${screenName}/status/${tweet?.rest_id || tweetId}`,
            },
        ],
    };
};
