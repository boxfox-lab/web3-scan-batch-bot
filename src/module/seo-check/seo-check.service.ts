import axios from 'axios';
import { sendDiscordMessage } from '../../remotes/discord/sendDiscordMessage';
import {
  SITE_URL,
  SEO_CHECK_PAGES,
  SEARCH_KEYWORDS,
  INFRA_ENDPOINTS,
  REQUEST_TIMEOUT,
  DISCORD_COLORS,
  SCORE_THRESHOLDS,
} from './seo-check.constants';
import {
  SeoReport,
  PageCheckResult,
  InfraCheckResult,
  InfraEndpointResult,
  SearchIndexResult,
  KeywordRankResult,
  LighthouseScores,
  MetaTagsResult,
} from './seo-check.types';

export class SeoCheckService {
  private readonly DISCORD_WEBHOOK_URL =
    process.env.DISCORD_SEO_WEBHOOK_URL || '';
  private readonly PAGESPEED_API_KEY = process.env.PAGESPEED_API_KEY || '';
  private readonly GOOGLE_SEARCH_API_KEY =
    process.env.GOOGLE_SEARCH_API_KEY || '';
  private readonly GOOGLE_SEARCH_ENGINE_ID =
    process.env.GOOGLE_SEARCH_ENGINE_ID || '';
  private previousScore: number | null = null;

  async process(): Promise<void> {
    const startTime = Date.now();
    console.log('[SEO Check] 일일 SEO 점검 시작');

    const [infraCheck, pageResults, searchIndex] = await Promise.all([
      this.checkInfrastructure(),
      this.checkAllPages(),
      this.checkSearchIndex(),
    ]);

    const overallScore = this.calculateOverallScore(infraCheck, pageResults);

    const report: SeoReport = {
      timestamp: new Date().toISOString(),
      siteUrl: SITE_URL,
      infraCheck,
      pageResults,
      searchIndex,
      overallScore,
      previousScore: this.previousScore,
      totalIssues: [
        ...infraCheck.issues,
        ...pageResults.flatMap((r) => r.issues),
        ...(searchIndex?.issues || []),
      ],
    };

    this.previousScore = overallScore;

    const duration = Date.now() - startTime;
    await this.sendSeoReport(report, duration);

    console.log(
      `[SEO Check] 완료 (${(duration / 1000).toFixed(1)}초, 점수: ${overallScore})`,
    );
  }

  private async checkInfrastructure(): Promise<InfraCheckResult> {
    const issues: string[] = [];
    const results: Record<string, InfraEndpointResult> = {};

    for (const [key, path] of Object.entries(INFRA_ENDPOINTS)) {
      const url = `${SITE_URL}${path}`;
      const start = Date.now();
      try {
        const response = await axios.get(url, {
          timeout: REQUEST_TIMEOUT,
          validateStatus: () => true,
        });
        results[key] = {
          available: response.status >= 200 && response.status < 400,
          statusCode: response.status,
          responseTimeMs: Date.now() - start,
        };
        if (response.status >= 400) {
          issues.push(`${path} — HTTP ${response.status}`);
        }
      } catch (error) {
        results[key] = {
          available: false,
          statusCode: 0,
          responseTimeMs: Date.now() - start,
        };
        issues.push(
          `${path} 접근 불가: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return {
      sitemapXml: results.sitemapXml,
      staticSitemapXml: results.staticSitemapXml,
      robotsTxt: results.robotsTxt,
      rssFeed: results.rssFeed,
      issues,
    };
  }

  private async checkAllPages(): Promise<PageCheckResult[]> {
    return Promise.all(
      SEO_CHECK_PAGES.map((page) =>
        this.checkPage(page.path, page.name, page.checkLighthouse),
      ),
    );
  }

  private async checkPage(
    path: string,
    pageName: string,
    checkLighthouse: boolean,
  ): Promise<PageCheckResult> {
    const url = `${SITE_URL}${path}`;
    const issues: string[] = [];

    let statusCode = 0;
    let responseTimeMs = 0;
    let htmlBody = '';

    const start = Date.now();
    try {
      const response = await axios.get(url, {
        timeout: REQUEST_TIMEOUT,
        validateStatus: () => true,
        headers: { 'User-Agent': 'WhaleScan-SEO-Bot/1.0' },
      });
      statusCode = response.status;
      responseTimeMs = Date.now() - start;
      htmlBody = typeof response.data === 'string' ? response.data : '';

      if (statusCode >= 400) {
        issues.push(`HTTP ${statusCode}`);
      }
      if (responseTimeMs > 3000) {
        issues.push(`느린 응답: ${responseTimeMs}ms`);
      }
    } catch (error) {
      responseTimeMs = Date.now() - start;
      issues.push(
        `접근 불가: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const metaTags = this.parseMetaTags(htmlBody);
    if (!metaTags.hasTitle) issues.push('Missing <title>');
    if (!metaTags.hasDescription) issues.push('Missing meta description');
    if (!metaTags.hasOgTitle) issues.push('Missing og:title');
    if (!metaTags.hasOgDescription) issues.push('Missing og:description');
    if (!metaTags.hasOgImage) issues.push('Missing og:image');
    if (!metaTags.hasCanonical) issues.push('Missing canonical URL');

    let lighthouse: LighthouseScores | null = null;
    if (checkLighthouse && this.PAGESPEED_API_KEY) {
      lighthouse = await this.getLighthouseScores(url);
    }

    return {
      url,
      pageName,
      statusCode,
      responseTimeMs,
      metaTags,
      lighthouse,
      issues,
    };
  }

  private parseMetaTags(html: string): MetaTagsResult {
    const getMetaContent = (nameOrProperty: string): string | null => {
      const regex = new RegExp(
        `<meta[^>]*(?:name|property)=["']${nameOrProperty}["'][^>]*content=["']([^"']*)["']|` +
          `<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProperty}["']`,
        'i',
      );
      const match = html.match(regex);
      return match ? match[1] || match[2] || null : null;
    };

    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : null;
    const canonicalMatch = html.match(
      /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i,
    );

    return {
      hasTitle: !!title && title.length > 0,
      title,
      hasDescription: !!getMetaContent('description'),
      description: getMetaContent('description'),
      hasOgTitle: !!getMetaContent('og:title'),
      hasOgDescription: !!getMetaContent('og:description'),
      hasOgImage: !!getMetaContent('og:image'),
      hasCanonical: !!canonicalMatch,
      hasRobotsMeta: !!getMetaContent('robots'),
    };
  }

  private async getLighthouseScores(
    url: string,
  ): Promise<LighthouseScores | null> {
    try {
      const apiUrl =
        'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
      const response = await axios.get(apiUrl, {
        params: {
          url,
          key: this.PAGESPEED_API_KEY,
          category: ['performance', 'accessibility', 'best-practices', 'seo'],
          strategy: 'mobile',
        },
        timeout: 60000,
      });

      const categories = response.data?.lighthouseResult?.categories;
      if (!categories) return null;

      return {
        performance: Math.round(
          (categories.performance?.score || 0) * 100,
        ),
        accessibility: Math.round(
          (categories.accessibility?.score || 0) * 100,
        ),
        bestPractices: Math.round(
          (categories['best-practices']?.score || 0) * 100,
        ),
        seo: Math.round((categories.seo?.score || 0) * 100),
      };
    } catch (error) {
      console.warn(
        `[SEO Check] Lighthouse 점수 조회 실패 (${url}):`,
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  private async checkSearchIndex(): Promise<SearchIndexResult | null> {
    if (!this.GOOGLE_SEARCH_API_KEY || !this.GOOGLE_SEARCH_ENGINE_ID) {
      console.log(
        '[SEO Check] Google Search API 키 미설정 — 검색 노출 체크 스킵',
      );
      return null;
    }

    const issues: string[] = [];
    const apiUrl = 'https://www.googleapis.com/customsearch/v1';

    // 1. site: 쿼리로 색인된 페이지 수 확인
    let totalIndexedPages: number | null = null;
    try {
      const siteResponse = await axios.get(apiUrl, {
        params: {
          key: this.GOOGLE_SEARCH_API_KEY,
          cx: this.GOOGLE_SEARCH_ENGINE_ID,
          q: `site:web3-scan.compounding.co.kr`,
        },
        timeout: REQUEST_TIMEOUT,
      });
      const totalStr =
        siteResponse.data?.searchInformation?.totalResults || '0';
      totalIndexedPages = parseInt(totalStr, 10);

      if (totalIndexedPages === 0) {
        issues.push('Google에 색인된 페이지가 0개입니다');
      }
    } catch (error) {
      console.warn(
        '[SEO Check] 색인 페이지 수 조회 실패:',
        error instanceof Error ? error.message : error,
      );
    }

    // 2. 주요 키워드별 검색 순위 확인
    const keywordRanks: KeywordRankResult[] = [];
    for (const keyword of SEARCH_KEYWORDS) {
      try {
        const response = await axios.get(apiUrl, {
          params: {
            key: this.GOOGLE_SEARCH_API_KEY,
            cx: this.GOOGLE_SEARCH_ENGINE_ID,
            q: keyword,
            num: 10,
          },
          timeout: REQUEST_TIMEOUT,
        });

        const items: any[] = response.data?.items || [];
        const siteHost = 'web3-scan.compounding.co.kr';
        const matchIndex = items.findIndex(
          (item: any) => item.link && item.link.includes(siteHost),
        );

        keywordRanks.push({
          keyword,
          rank: matchIndex >= 0 ? matchIndex + 1 : null,
          resultUrl: matchIndex >= 0 ? items[matchIndex].link : null,
          totalResults:
            response.data?.searchInformation?.totalResults || null,
        });

        if (matchIndex < 0) {
          issues.push(`"${keyword}" 검색 시 상위 10위 내 미노출`);
        }
      } catch (error) {
        console.warn(
          `[SEO Check] 키워드 "${keyword}" 순위 조회 실패:`,
          error instanceof Error ? error.message : error,
        );
        keywordRanks.push({
          keyword,
          rank: null,
          resultUrl: null,
          totalResults: null,
        });
      }
    }

    return { totalIndexedPages, keywordRanks, issues };
  }

  private calculateOverallScore(
    infra: InfraCheckResult,
    pages: PageCheckResult[],
  ): number {
    let totalScore = 0;
    let weightTotal = 0;

    // 인프라 점수 (20%)
    const infraItems = [
      infra.sitemapXml,
      infra.staticSitemapXml,
      infra.robotsTxt,
      infra.rssFeed,
    ];
    const infraScore =
      (infraItems.filter((i) => i.available).length / infraItems.length) * 100;
    totalScore += infraScore * 20;
    weightTotal += 20;

    // Lighthouse SEO 점수 (50% — 데이터 있는 경우만)
    const lighthousePages = pages.filter((p) => p.lighthouse);
    if (lighthousePages.length > 0) {
      const avgSeoScore =
        lighthousePages.reduce(
          (sum, p) => sum + (p.lighthouse?.seo || 0),
          0,
        ) / lighthousePages.length;
      totalScore += avgSeoScore * 50;
      weightTotal += 50;
    }

    // 메타태그 완성도 (20%)
    const metaChecks = pages.flatMap((p) => [
      p.metaTags.hasTitle,
      p.metaTags.hasDescription,
      p.metaTags.hasOgTitle,
      p.metaTags.hasOgDescription,
      p.metaTags.hasOgImage,
      p.metaTags.hasCanonical,
    ]);
    const metaScore =
      (metaChecks.filter(Boolean).length / metaChecks.length) * 100;
    totalScore += metaScore * 20;
    weightTotal += 20;

    // 페이지 가용성 (10%)
    const availablePages = pages.filter(
      (p) => p.statusCode >= 200 && p.statusCode < 400,
    );
    const availScore = (availablePages.length / pages.length) * 100;
    totalScore += availScore * 10;
    weightTotal += 10;

    return Math.round(totalScore / weightTotal);
  }

  private async sendSeoReport(
    report: SeoReport,
    durationMs: number,
  ): Promise<void> {
    if (!this.DISCORD_WEBHOOK_URL) {
      console.warn(
        '[SEO Check] DISCORD_SEO_WEBHOOK_URL이 설정되지 않아 리포트를 전송하지 않습니다.',
      );
      return;
    }

    const scoreColor =
      report.overallScore >= SCORE_THRESHOLDS.good
        ? DISCORD_COLORS.success
        : report.overallScore >= SCORE_THRESHOLDS.warning
          ? DISCORD_COLORS.warning
          : DISCORD_COLORS.error;

    const scoreEmoji =
      report.overallScore >= SCORE_THRESHOLDS.good
        ? '🟢'
        : report.overallScore >= SCORE_THRESHOLDS.warning
          ? '🟡'
          : '🔴';

    const trendText =
      report.previousScore !== null
        ? ` (이전: ${report.previousScore}점 ${report.overallScore > report.previousScore ? '📈' : report.overallScore < report.previousScore ? '📉' : '➡️'})`
        : '';

    const infraStatus = [
      `${report.infraCheck.sitemapXml.available ? '✅' : '❌'} sitemap.xml (${report.infraCheck.sitemapXml.responseTimeMs}ms)`,
      `${report.infraCheck.staticSitemapXml.available ? '✅' : '❌'} static-sitemap.xml (${report.infraCheck.staticSitemapXml.responseTimeMs}ms)`,
      `${report.infraCheck.robotsTxt.available ? '✅' : '❌'} robots.txt (${report.infraCheck.robotsTxt.responseTimeMs}ms)`,
      `${report.infraCheck.rssFeed.available ? '✅' : '❌'} RSS feed (${report.infraCheck.rssFeed.responseTimeMs}ms)`,
    ].join('\n');

    const pageStatusLines = report.pageResults.map((p) => {
      const statusEmoji =
        p.statusCode >= 200 && p.statusCode < 400 ? '✅' : '❌';
      const lighthouseText = p.lighthouse
        ? ` | SEO: ${p.lighthouse.seo} Perf: ${p.lighthouse.performance}`
        : '';
      const issueCount =
        p.issues.length > 0 ? ` ⚠️${p.issues.length}` : '';
      return `${statusEmoji} ${p.pageName} (${p.responseTimeMs}ms${lighthouseText}${issueCount})`;
    });

    const lighthousePages = report.pageResults.filter((p) => p.lighthouse);
    const lighthouseDetail =
      lighthousePages.length > 0
        ? lighthousePages
            .map((p) => {
              const l = p.lighthouse!;
              return (
                `**${p.pageName}**\n` +
                `  SEO: ${this.scoreIndicator(l.seo)} ${l.seo} | ` +
                `Performance: ${this.scoreIndicator(l.performance)} ${l.performance} | ` +
                `Accessibility: ${this.scoreIndicator(l.accessibility)} ${l.accessibility} | ` +
                `Best Practices: ${this.scoreIndicator(l.bestPractices)} ${l.bestPractices}`
              );
            })
            .join('\n\n')
        : 'Lighthouse 점수 없음 (API 키 미설정)';

    const issuesText =
      report.totalIssues.length > 0
        ? report.totalIssues
            .slice(0, 15)
            .map((i) => `• ${i}`)
            .join('\n') +
          (report.totalIssues.length > 15
            ? `\n...외 ${report.totalIssues.length - 15}개`
            : '')
        : '발견된 이슈 없음 ✨';

    const fields = [
      {
        name: '🔧 인프라 상태',
        value: infraStatus,
        inline: false,
      },
      {
        name: '📄 페이지 상태',
        value: pageStatusLines.slice(0, 6).join('\n'),
        inline: false,
      },
    ];

    if (pageStatusLines.length > 6) {
      fields.push({
        name: '📄 페이지 상태 (계속)',
        value: pageStatusLines.slice(6).join('\n'),
        inline: false,
      });
    }

    // 검색 노출 결과
    if (report.searchIndex) {
      const si = report.searchIndex;
      const indexedText =
        si.totalIndexedPages !== null
          ? `📊 색인된 페이지: **${si.totalIndexedPages}개**\n\n`
          : '';

      const rankLines = si.keywordRanks.map((kr) => {
        if (kr.rank !== null) {
          const rankEmoji = kr.rank <= 3 ? '🥇' : kr.rank <= 5 ? '🥈' : '🔹';
          return `${rankEmoji} "${kr.keyword}" — **${kr.rank}위**`;
        }
        return `❌ "${kr.keyword}" — 상위 10위 내 미노출`;
      });

      fields.push({
        name: '🔎 Google 검색 노출',
        value: (indexedText + rankLines.join('\n')).substring(0, 1024),
        inline: false,
      });
    }

    fields.push(
      {
        name: '🔍 Lighthouse 점수 (Mobile)',
        value: lighthouseDetail.substring(0, 1024),
        inline: false,
      },
      {
        name: `⚠️ 발견된 이슈 (${report.totalIssues.length}개)`,
        value: issuesText.substring(0, 1024),
        inline: false,
      },
      {
        name: '⏱️ 소요 시간',
        value: `${(durationMs / 1000).toFixed(1)}초`,
        inline: true,
      },
      {
        name: '📅 검사 시각',
        value: new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
        inline: true,
      },
    );

    try {
      await sendDiscordMessage(
        {
          embeds: [
            {
              title: `${scoreEmoji} 일일 SEO 리포트 — ${report.overallScore}점${trendText}`,
              description: `**${report.siteUrl}** 일일 SEO 점검 결과`,
              color: scoreColor,
              fields,
              timestamp: report.timestamp,
              footer: { text: 'WhaleScan SEO Bot' },
            },
          ],
        },
        this.DISCORD_WEBHOOK_URL,
      );
    } catch (error) {
      console.error('[SEO Check] Discord 리포트 전송 실패:', error);
    }
  }

  private scoreIndicator(score: number): string {
    if (score >= 90) return '🟢';
    if (score >= 50) return '🟡';
    return '🔴';
  }
}
