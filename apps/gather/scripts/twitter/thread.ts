/* @meta
{
  "name": "twitter/thread",
  "description": "获取 twitter 的 thread 数据",
  "domain": "x.com",
  "args": {
    "tweet_id": {
      "required": true,
      "description": "Script argument: tweet_id"
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
  "example": "bb-browser site twitter/thread 1900000000000000000 50",
  "category": "INTERACTIVE",
  "auth": {
    "required": true,
    "kind": "twitter-cookie",
    "description": "twitter auth credential"
  },
  "tags": [
    "foreign"
  ]
}
*/

async () => {
  const tweetId = String(__TWEET_ID_JSON__ || '').trim();
  const limit = Number(__COUNT__) || 50;
  if (!tweetId) {
    return { error: 'tweet_id is required' };
  }

  const ct0 = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) {
    return { error: 'No ct0 cookie - not logged into x.com' };
  }

  const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const fallbackQueryId = 'nBS-WpgA6ZG0CyNHD517JQ';
  const features = {
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    longform_notetweets_consumption_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
  };
  const fieldToggles = { withArticleRichContentState: true, withArticlePlainText: false };
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

  const queryId = await resolveQueryId('TweetDetail', fallbackQueryId);
  const variables = {
    focalTweetId: tweetId,
    referrer: 'tweet',
    with_rux_injections: false,
    includePromotedContent: false,
    rankingMode: 'Recency',
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
  };

  const apiUrl = `/i/api/graphql/${queryId}/TweetDetail?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;
  const response = await fetch(apiUrl, { headers, credentials: 'include' });
  if (!response.ok) {
    return { error: `HTTP ${response.status}`, hint: 'Tweet not found or queryId expired' };
  }

  const payload = await response.json();
  const instructions = payload?.data?.threaded_conversation_with_injections_v2?.instructions || payload?.data?.tweetResult?.result?.timeline?.instructions || [];
  const seen = new Set();
  const tweets = [];

  const pushTweet = (result) => {
    const tweet = result?.tweet || result;
    const legacy = tweet?.legacy || {};
    const restId = tweet?.rest_id;
    if (!restId || seen.has(restId)) return;
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
      in_reply_to: legacy.in_reply_to_status_id_str || null,
      created_at: legacy.created_at || '',
      url: `https://x.com/${screenName}/status/${restId}`,
    });
  };

  for (const inst of instructions) {
    for (const entry of inst?.entries || []) {
      pushTweet(entry?.content?.itemContent?.tweet_results?.result);
      for (const item of entry?.content?.items || []) {
        pushTweet(item?.item?.itemContent?.tweet_results?.result);
      }
    }
  }

  return { tweet_id: tweetId, count: tweets.length, tweets: tweets.slice(0, limit) };
};
