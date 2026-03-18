declare global {
  const __QUERY_JSON__: string;
  const __PRODUCT_JSON__: string;
  const __COUNT__: number;
  const __SCROLL_TIMES__: number;
  const __USERNAME_JSON__: string;
  const __TWEET_ID_JSON__: string;

  interface Window {
    __oakGatherCapture?: any[];
  }
}

export {};
