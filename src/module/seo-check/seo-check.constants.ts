export const SITE_URL = 'https://web3-scan.compounding.co.kr';

export const SEO_CHECK_PAGES = [
  { path: '/', name: 'Homepage (KO)', checkLighthouse: true },
  { path: '/en/', name: 'Homepage (EN)', checkLighthouse: false },
  { path: '/blog/', name: 'Blog', checkLighthouse: true },
  { path: '/charts/btcusd-longs/', name: 'BTC/USD Longs', checkLighthouse: false },
  { path: '/charts/ethusd-longs/', name: 'ETH/USD Longs', checkLighthouse: false },
  { path: '/charts/total3/', name: 'Total3', checkLighthouse: false },
  { path: '/charts/btc-dominance/', name: 'BTC Dominance', checkLighthouse: false },
  { path: '/charts/btc-cme-futures/', name: 'BTC CME Futures', checkLighthouse: true },
  { path: '/charts/fear-greed/', name: 'Fear & Greed', checkLighthouse: true },
  { path: '/charts/btc-monthly-returns/', name: 'BTC Monthly Returns', checkLighthouse: false },
  { path: '/charts/kimchi-premium/', name: 'Kimchi Premium', checkLighthouse: true },
  { path: '/positions/james-win/', name: 'Positions: James Win', checkLighthouse: false },
] as const;

export const INFRA_ENDPOINTS = {
  sitemapXml: '/sitemap.xml',
  staticSitemapXml: '/static-sitemap.xml',
  robotsTxt: '/robots.txt',
  rssFeed: '/rss.xml/',
} as const;

// 검색 노출 체크용 키워드 (Google Custom Search API)
export const SEARCH_KEYWORDS = [
  '웨일스캔',
  'WhaleScan',
  '비트코인 김치프리미엄',
  '비트코인 공포탐욕지수',
  '비트코인 CME 선물',
  'BTC dominance chart',
  '비트코인 월별 수익률',
] as const;

export const REQUEST_TIMEOUT = 30000;

export const DISCORD_COLORS = {
  success: 0x2ecc71,
  warning: 0xf39c12,
  error: 0xe74c3c,
} as const;

export const SCORE_THRESHOLDS = {
  good: 90,
  warning: 50,
} as const;
