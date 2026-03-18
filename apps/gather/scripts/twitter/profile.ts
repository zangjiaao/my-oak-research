async () => {
  const username = String(__USERNAME_JSON__ || "").replace(/^@/, "").trim();
  if (!username) {
    return { error: "username is required" };
  }
  const ct0 = document.cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('ct0='))?.split('=')[1];
  if (!ct0) {
    return { error: "No ct0 cookie - not logged into x.com" };
  }

  const bearer = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const headers = {
    Authorization: `Bearer ${decodeURIComponent(bearer)}`,
    'X-Csrf-Token': ct0,
    'X-Twitter-Auth-Type': 'OAuth2Session',
    'X-Twitter-Active-User': 'yes',
  };

  const variables = JSON.stringify({ screen_name: username, withSafetyModeUserFields: true });
  const features = JSON.stringify({
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  });

  const url = `/i/api/graphql/qRednkZG-rn1P6b48NINmQ/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;
  const response = await fetch(url, { headers, credentials: 'include' });
  if (!response.ok) {
    return { error: `HTTP ${response.status}` };
  }
  const payload = await response.json();
  const result = payload?.data?.user?.result;
  if (!result) {
    return { error: `User @${username} not found` };
  }
  const legacy = result.legacy || {};
  const expandedUrl = legacy.entities?.url?.urls?.[0]?.expanded_url || '';

  return {
    username,
    profiles: [
      {
        screen_name: legacy.screen_name || username,
        name: legacy.name || '',
        bio: legacy.description || '',
        location: legacy.location || '',
        url: expandedUrl,
        followers: legacy.followers_count || 0,
        following: legacy.friends_count || 0,
        tweets: legacy.statuses_count || 0,
        likes: legacy.favourites_count || 0,
        verified: result.is_blue_verified || legacy.verified || false,
        created_at: legacy.created_at || '',
      },
    ],
  };
};
