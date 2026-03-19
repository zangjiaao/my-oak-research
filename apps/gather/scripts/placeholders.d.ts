declare global {
  const __QUERY_JSON__: string;
  const __SUBREDDIT_JSON__: string;
  const __PRODUCT_JSON__: string;
  const __SORT_JSON__: string;
  const __TIME_JSON__: string;
  const __LIMIT__: number;
  const __COUNT__: number;
  const __SCROLL_TIMES__: number;
  const __USERNAME_JSON__: string;
  const __TWEET_ID_JSON__: string;
  const __XHS_USER_ID_JSON__: string;
  const __NOTIFICATION_TYPE_JSON__: string;
  const __LOCATION_JSON__: string;
  const __COMPANY_JSON__: string;
  const __EXPERIENCE_LEVEL_JSON__: string;
  const __JOB_TYPE_JSON__: string;
  const __DATE_POSTED_JSON__: string;
  const __REMOTE_JSON__: string;
  const __START__: number;
  const __DETAILS__: boolean;
  const __KEYWORD_JSON__: string;
  const __SLUG_JSON__: string;
  const __PERIOD_JSON__: string;
  const __CATEGORY_ID__: number;
  const __TOPIC_ID__: number;
  const __URL_JSON__: string;
  const __LANG_JSON__: string;
  const __MODE_JSON__: string;
  const __CHANNEL_ID_JSON__: string;

  interface Window {
    __oakGatherCapture?: any[];
    __oakXhsPostedHooked?: boolean;
    __oakXhsFeedHooked?: boolean;
    __oakXhsNotificationHooked?: boolean;
    ytcfg?: { data_?: Record<string, any> };
    ytInitialPlayerResponse?: any;
    ytInitialData?: any;
  }
}

export {};
