// Sample /v3/fetch key parts
// intent.type: tweets
// intent.args: {"username":"openai","limit":20}
// output.field: {"id":"tweets.id","type":"tweets.type","author":"tweets.author","text":"tweets.text","url":"tweets.url","created_at":"tweets.created_at"}
// category: "INTERACTIVE"
// auth.required: true
// auth.kind: "twitter-cookie"
// auth.description: "twitter auth credential"
// tags: ["foreign"]

async () => {
  const username = String(__USERNAME_JSON__ || '').replace(/^@/, '').trim();
  const limit = Math.max(1, Math.min(Number(__COUNT__) || 20, 100));
  if (!username) {
    return { error: 'username is required' };
  }

  const ct0 = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) {
    return { error: 'No ct0 cookie - not logged into x.com' };
  }

  const bearer = decodeURIComponent('AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA');
  const headers = {
    Authorization: `Bearer ${bearer}`,
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

  const userByNameQueryId = await resolveQueryId('UserByScreenName', 'pLsOiyHJ1eFwPJlNmLp4Bg');
  const userVariables = JSON.stringify({
    screen_name: username,
    withSafetyModeUserFields: true,
  });
  const userFeatures = JSON.stringify({
    hidden_profile_subscriptions_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  });
  const userUrl = `/i/api/graphql/${userByNameQueryId}/UserByScreenName?variables=${encodeURIComponent(userVariables)}&features=${encodeURIComponent(userFeatures)}`;
  const userResp = await fetch(userUrl, { headers, credentials: 'include' });
  if (!userResp.ok) {
    return { error: `Failed to resolve user: HTTP ${userResp.status}` };
  }
  const userData = await userResp.json();
  const userId = userData?.data?.user?.result?.rest_id;
  if (!userId) {
    return { error: `User @${username} not found` };
  }

  const userTweetsQueryId = await resolveQueryId('UserTweets', 'Y59DTUMfcKmUAATiT2SlTw');
  const features = {
    rweb_video_screen_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_enhance_cards_enabled: false,
  };
  const fieldToggles = { withArticlePlainText: false };

  const seen = new Set();
  const tweets = [];
  let cursor = null;

  for (let i = 0; i < 5 && tweets.length < limit; i += 1) {
    const variables = {
      userId,
      count: Math.min(40, limit - tweets.length + 5),
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
    };
    if (cursor) variables.cursor = cursor;

    const timelineUrl = `/i/api/graphql/${userTweetsQueryId}/UserTweets?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;
    const resp = await fetch(timelineUrl, { headers, credentials: 'include' });
    if (!resp.ok) {
      if (tweets.length === 0) {
        return { error: `HTTP ${resp.status}`, hint: 'queryId may have changed' };
      }
      break;
    }

    const payload = await resp.json();
    const instructions =
      payload?.data?.user?.result?.timeline_v2?.timeline?.instructions ||
      payload?.data?.user?.result?.timeline?.timeline?.instructions ||
      [];

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
        if (!result) continue;
        const tweet = result.tweet || result;
        const legacy = tweet?.legacy || {};
        const restId = tweet?.rest_id;
        if (!restId || seen.has(restId)) continue;
        seen.add(restId);

        const user = tweet?.core?.user_results?.result;
        const screenName = user?.legacy?.screen_name || user?.core?.screen_name || username;
        const noteText = tweet?.note_tweet?.note_tweet_results?.result?.text;
        const retweetResult = legacy?.retweeted_status_result?.result;

        if (retweetResult) {
          const retweet = retweetResult?.tweet || retweetResult;
          const retweetLegacy = retweet?.legacy || {};
          const retweetUser = retweet?.core?.user_results?.result;
          const retweetNoteText = retweet?.note_tweet?.note_tweet_results?.result?.text;
          tweets.push({
            id: restId,
            type: 'retweet',
            author: screenName,
            url: `https://x.com/${screenName || '_'}/status/${restId}`,
            rt_author:
              retweetUser?.legacy?.screen_name || retweetUser?.core?.screen_name || '',
            text: retweetNoteText || retweetLegacy.full_text || '',
            likes: retweetLegacy.favorite_count || 0,
            retweets: retweetLegacy.retweet_count || 0,
            replies: retweetLegacy.reply_count || 0,
            created_at: legacy.created_at || retweetLegacy.created_at || '',
          });
          continue;
        }

        tweets.push({
          id: restId,
          type: 'tweet',
          author: screenName,
          url: `https://x.com/${screenName || '_'}/status/${restId}`,
          text: noteText || legacy.full_text || '',
          likes: legacy.favorite_count || 0,
          retweets: legacy.retweet_count || 0,
          replies: legacy.reply_count || 0,
          in_reply_to: legacy.in_reply_to_status_id_str || undefined,
          created_at: legacy.created_at || '',
        });
      }
    }

    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return {
    username,
    user_id: userId,
    count: tweets.length,
    tweets: tweets.slice(0, limit),
  };
};
