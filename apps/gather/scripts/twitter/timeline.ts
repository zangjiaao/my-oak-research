// Sample /v3/fetch key parts
// intent.type: timeline
// intent.args: {"limit":20}
// output.field: {"id":"tweets.id","text":"tweets.text","author":"tweets.author","url":"tweets.url","created_at":"tweets.created_at"}

async () => {
  const limit = Number(__COUNT__) || 20;
  const ct0 = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) {
    return { error: 'No ct0 cookie - not logged into x.com' };
  }

  const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const fallbackQueryId = 'c-CzHF1LboFilMpsx4ZCrQ';
  const features = {
    rweb_video_screen_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };
  const headers = {
    Authorization: `Bearer ${decodeURIComponent(bearer)}`,
    'X-Csrf-Token': ct0,
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Active-User': 'yes',
  };

  async function resolveQueryId(operationName, fallbackId) {
    try {
      const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
      if (ghResp.ok) {
        const data = await ghResp.json();
        const entry = data[operationName];
        if (entry && entry.queryId) return entry.queryId;
      }
    } catch (_error) {}
    return fallbackId;
  }

  const queryId = await resolveQueryId('HomeTimeline', fallbackQueryId);
  const seen = new Set();
  const tweets = [];
  let cursor = null;

  for (let i = 0; i < 5 && tweets.length < limit; i += 1) {
    const variables = {
      count: Math.min(40, limit - tweets.length + 5),
      includePromotedContent: false,
      latestControlAvailable: true,
      requestContext: 'launch',
      withCommunity: true,
    };
    if (cursor) variables.cursor = cursor;

    const apiUrl = `/i/api/graphql/${queryId}/HomeTimeline?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}`;
    const response = await fetch(apiUrl, { headers, credentials: 'include' });
    if (!response.ok) {
      if (tweets.length === 0) return { error: `HTTP ${response.status}`, hint: 'queryId may have expired' };
      break;
    }
    const payload = await response.json();
    const instructions = payload?.data?.home?.home_timeline_urt?.instructions || [];

    let nextCursor = null;
    for (const inst of instructions) {
      for (const entry of inst?.entries || []) {
        const content = entry?.content;
        if (entry?.entryId?.startsWith('cursor-bottom-')) {
          nextCursor = content?.value || nextCursor;
          continue;
        }
        if (content?.cursorType === 'Bottom') {
          nextCursor = content?.value || nextCursor;
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
          text: noteText || legacy.full_text || '',
          likes: legacy.favorite_count || 0,
          retweets: legacy.retweet_count || 0,
          replies: legacy.reply_count || 0,
          views: Number(tweet?.views?.count || 0),
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
