export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface MetaTagsResult {
  hasTitle: boolean;
  title: string | null;
  hasDescription: boolean;
  description: string | null;
  hasOgTitle: boolean;
  hasOgDescription: boolean;
  hasOgImage: boolean;
  hasCanonical: boolean;
  hasRobotsMeta: boolean;
}

export interface PageCheckResult {
  url: string;
  pageName: string;
  statusCode: number;
  responseTimeMs: number;
  metaTags: MetaTagsResult;
  lighthouse: LighthouseScores | null;
  issues: string[];
}

export interface InfraEndpointResult {
  available: boolean;
  statusCode: number;
  responseTimeMs: number;
}

export interface InfraCheckResult {
  sitemapXml: InfraEndpointResult;
  staticSitemapXml: InfraEndpointResult;
  robotsTxt: InfraEndpointResult;
  rssFeed: InfraEndpointResult;
  issues: string[];
}

export interface KeywordRankResult {
  keyword: string;
  rank: number | null; // 검색 결과 내 순위 (1-based), null이면 미노출
  resultUrl: string | null; // 검색 결과에 노출된 URL
  totalResults: string | null; // 전체 검색 결과 수
}

export interface SearchIndexResult {
  totalIndexedPages: number | null; // site: 쿼리로 확인한 색인 페이지 수
  keywordRanks: KeywordRankResult[];
  issues: string[];
}

export interface SeoReport {
  timestamp: string;
  siteUrl: string;
  infraCheck: InfraCheckResult;
  pageResults: PageCheckResult[];
  searchIndex: SearchIndexResult | null;
  overallScore: number;
  previousScore: number | null;
  totalIssues: string[];
}
