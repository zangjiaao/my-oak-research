async () => {
  const limit = Number(__COUNT__) || 20;
  const ct0 = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) {
    return { error: "No ct0 cookie - not logged into x.com" };
  }

  const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const queryId = 'Fy0QMy4q_aZCpkO0PnyLYw';
  const features = {
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    longform_notetweets_consumption_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
  };
  const headers = {
    Authorization: `Bearer ${decodeURIComponent(bearer)}`,
    'X-Csrf-Token': ct0,
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Active-User': 'yes',
  };

  const seen = new Set();
  const tweets = [];
  let cursor = null;

  for (let i = 0; i < 5 && tweets.length < limit; i += 1) {
    const variables = { count: Math.min(100, limit - tweets.length + 10), includePromotedContent: false };
    if (cursor) variables.cursor = cursor;

    const apiUrl = `/i/api/graphql/${queryId}/Bookmarks?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
    const response = await fetch(apiUrl, { headers, credentials: 'include' });
    if (!response.ok) break;
    const payload = await response.json();
    const instructions = payload?.data?.bookmark_timeline_v2?.timeline?.instructions || payload?.data?.bookmark_timeline?.timeline?.instructions || [];

    let nextCursor = null;
    for (const inst of instructions) {
      for (const entry of inst?.entries || []) {
        const content = entry?.content;
        if (entry?.entryId?.startsWith('cursor-bottom-') || entry?.entryId?.startsWith('cursor-showMore-')) {
          nextCursor = content?.value || content?.itemContent?.value || nextCursor;
          continue;
        }
        const result = content?.itemContent?.tweet_results?.result;
        const tweet = result?.tweet || result;
        const legacy = tweet?.legacy || {};
        const restId = tweet?.rest_id;
        if (!restId || seen.has(restId)) continue;
        seen.add(restId);
        const user = tweet?.core?.user_results?.result;
        const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';
        const noteText = tweet?.note_tweet?.note_tweet_results?.result?.text;
        tweets.push({
          id: restId,
          author: screenName,
          name: user?.legacy?.name || user?.core?.name || '',
          text: noteText || legacy.full_text || '',
          likes: legacy.favorite_count || 0,
          retweets: legacy.retweet_count || 0,
          created_at: legacy.created_at || '',
          url: `https://x.com/${screenName}/status/${restId}`,
        });
      }
    }

    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return { count: tweets.length, tweets: tweets.slice(0, limit) };
};
