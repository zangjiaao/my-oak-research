async () => {
  const tweetId = String(__TWEET_ID_JSON__ || '').trim();
  if (!tweetId) {
    return { error: 'tweet_id is required' };
  }

  const ct0 = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) {
    return { error: "No ct0 cookie - not logged into x.com" };
  }

  const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const queryId = '7xflPyRiUxGVbJd4uWmbfg';
  const features = {
    responsive_web_graphql_exclude_directive_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    longform_notetweets_consumption_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
  };
  const fieldToggles = { withArticleRichContentState: true, withArticlePlainText: false };
  const headers = {
    Authorization: `Bearer ${decodeURIComponent(bearer)}`,
    'X-Csrf-Token': ct0,
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Active-User': 'yes',
  };

  const variables = {
    tweetId,
    withCommunity: true,
    includePromotedContent: false,
    withVoice: true,
  };

  const apiUrl = `/i/api/graphql/${queryId}/TweetResultByRestId?variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(features))}&fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`;
  const response = await fetch(apiUrl, { headers, credentials: 'include' });
  if (!response.ok) {
    return { error: `HTTP ${response.status}` };
  }

  const payload = await response.json();
  const result = payload?.data?.tweetResult?.result;
  const tweet = result?.tweet || result;
  if (!tweet) {
    return { error: 'Article not found' };
  }

  const user = tweet?.core?.user_results?.result;
  const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';
  const article = tweet?.article?.article_results?.result;
  const noteText = tweet?.note_tweet?.note_tweet_results?.result?.text;

  if (!article && !noteText) {
    return { error: `Tweet ${tweetId} has no article content` };
  }

  const blocks = article?.content_state?.blocks || [];
  const lines = [];
  for (const block of blocks) {
    const text = block?.text || '';
    if (!text) continue;
    lines.push(text);
  }

  return {
    tweet_id: tweetId,
    items: [
      {
        id: tweet?.rest_id || tweetId,
        author: screenName,
        title: article?.title || '(Note Tweet)',
        content: lines.join('\\n\\n') || noteText || tweet?.legacy?.full_text || '',
        url: `https://x.com/${screenName}/status/${tweet?.rest_id || tweetId}`,
      },
    ],
  };
};
