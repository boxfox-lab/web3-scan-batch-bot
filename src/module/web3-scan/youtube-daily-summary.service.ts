import fs from 'fs';
import OpenAI from 'openai';
import { subDays } from 'date-fns';
import axios from 'axios';
import { findAllYoutube, YoutubeEntity } from '../../remotes/web3-scan/youtube';
import { createBlog } from '../../remotes/web3-scan/blog';
import {
  searchGoogleNews,
  GoogleNewsResult,
} from '../../remotes/web3-scan/google-search';
import { GlobalErrorHandler } from '../../util/error/global-error-handler';
import { sendDiscordMessage } from '../../remotes/discord/sendDiscordMessage';
import { GeminiImageGenerationService } from './gemini-image-generation.service';
import { GeminiImageBatchService } from './gemini-image-batch.service';
import { JobState, BatchJob } from '@google/genai';

// Batch API를 위한 타입 정의
interface BatchJobOutput {
  custom_id: string;
  response: {
    status_code: number;
    request_id: string;
    body: {
      id: string;
      choices: Array<{
        index: number;
        message: {
          role: string;
          content: string;
          function_call?: {
            name: string;
            arguments: string;
          };
        };
        finish_reason: string;
      }>;
      created: number;
      model: string;
    };
    service_tier: 'default';
    system_fingerprint: null;
  };
  error?: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

// 배치 작업 캐시 타입
interface BatchJobCache {
  jobId: string;
  jobType: 'blog' | 'translation';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  groups: Array<{
    groupIndex: number;
    topic: string;
    contents: YoutubeEntity[];
    newsResults?: GoogleNewsResult[];
  }>;
  batchFilePath?: string;
  blogResults?: Map<
    number,
    { title: string; content: string; thumbnail?: string }
  >;
  thumbnailJobId?: string; // Gemini 배치 작업 ID
  thumbnailStatus?: Map<
    number,
    'pending' | 'processing' | 'completed' | 'failed'
  >;
  thumbnailUrls?: Map<number, string>;
  sourceBlogJobId?: string; // 번역 작업의 경우 원본 블로그 작업 ID
}

const BATCH_CACHE_FILE = 'daily-summary-batch-jobs-cache.json';

export class YoutubeDailySummaryService {
  private readonly geminiImageService: GeminiImageGenerationService;
  public readonly geminiImageBatchService: GeminiImageBatchService;

  constructor(private readonly openai: OpenAI) {
    this.geminiImageService = new GeminiImageGenerationService(
      undefined,
      openai,
    );
    this.geminiImageBatchService = new GeminiImageBatchService();
  }

  // 배치 작업 캐시 파일 읽기
  private readBatchCache(): BatchJobCache[] {
    try {
      if (!fs.existsSync(BATCH_CACHE_FILE)) {
        return [];
      }
      const content = fs.readFileSync(BATCH_CACHE_FILE, 'utf8');
      const cache = JSON.parse(content);
      // blogResults, thumbnailStatus, thumbnailUrls를 Map으로 복원
      // undefined 대신 빈 Map을 반환하여 런타임 에러 방지
      return cache.map((item: any) => ({
        ...item,
        blogResults: item.blogResults
          ? new Map(
              Object.entries(item.blogResults).map(([k, v]) => [Number(k), v]),
            )
          : new Map(),
        thumbnailStatus: item.thumbnailStatus
          ? new Map(
              Object.entries(item.thumbnailStatus).map(([k, v]) => [
                Number(k),
                v,
              ]),
            )
          : new Map(),
        thumbnailUrls: item.thumbnailUrls
          ? new Map(
              Object.entries(item.thumbnailUrls).map(([k, v]) => [
                Number(k),
                v,
              ]),
            )
          : new Map(),
      }));
    } catch (error) {
      console.error('[DailySummaryBatch] 캐시 파일 읽기 실패:', error);
      return [];
    }
  }

  // 배치 작업 캐시 파일 저장
  private saveBatchCache(cache?: BatchJobCache[]): void {
    try {
      const cacheToSave = cache || this.readBatchCache();
      // blogResults, thumbnailStatus, thumbnailUrls를 객체로 변환
      const serializableCache = cacheToSave.map((item) => ({
        ...item,
        blogResults: item.blogResults
          ? Object.fromEntries(item.blogResults)
          : undefined,
        thumbnailStatus: item.thumbnailStatus
          ? Object.fromEntries(item.thumbnailStatus)
          : undefined,
        thumbnailUrls: item.thumbnailUrls
          ? Object.fromEntries(item.thumbnailUrls)
          : undefined,
      }));
      fs.writeFileSync(
        BATCH_CACHE_FILE,
        JSON.stringify(serializableCache, null, 2),
        'utf8',
      );
    } catch (error) {
      console.error('[DailySummaryBatch] 캐시 파일 저장 실패:', error);
    }
  }

  // 배치 작업 캐시에 추가
  private addBatchJobToCache(job: BatchJobCache): void {
    const cache = this.readBatchCache();
    cache.push(job);
    this.saveBatchCache(cache);
  }

  // 배치 작업 캐시에서 제거
  private removeBatchJobFromCache(jobId: string): void {
    const cache = this.readBatchCache();
    const filtered = cache.filter((job) => job.jobId !== jobId);
    this.saveBatchCache(filtered);
  }

  // 배치 작업 캐시 업데이트
  private updateBatchJobCache(
    jobId: string,
    updates: Partial<BatchJobCache>,
  ): void {
    const cache = this.readBatchCache();
    const index = cache.findIndex((job) => job.jobId === jobId);
    if (index !== -1) {
      // readBatchCache에서 이미 빈 Map을 보장하므로 단순 병합 가능
      cache[index] = { ...cache[index], ...updates };
      this.saveBatchCache(cache);
    }
  }

  async process() {
    try {
      // 24시간 전 시간 계산
      const yesterday = subDays(new Date(), 1);
      const now = new Date();

      console.log(
        `[YoutubeDailySummary] 24시간 내 요약 컨텐츠 조회 시작: ${yesterday.toISOString()} ~ ${now.toISOString()}`,
      );

      // 모든 유튜브 요약 컨텐츠 조회
      let allYoutubeContents: YoutubeEntity[] = [];
      try {
        allYoutubeContents = await findAllYoutube();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // 403 에러인 경우 상세한 정보를 디스코드로 전송
        if (axios.isAxiosError(error) && error.response?.status === 403) {
          console.error(
            `[YoutubeDailySummary] 유튜브 컨텐츠 조회 실패 (403 Forbidden):`,
            error,
          );

          try {
            const timestamp = new Date().toISOString();
            const statusCode = error.response.status;
            const statusText = error.response.statusText;
            const responseData = error.response.data
              ? JSON.stringify(error.response.data, null, 2)
              : '응답 데이터 없음';
            const responseHeaders = error.response.headers
              ? JSON.stringify(error.response.headers, null, 2)
              : '헤더 정보 없음';
            const requestUrl = error.config?.url || 'URL 정보 없음';
            const requestMethod =
              error.config?.method?.toUpperCase() || 'METHOD 정보 없음';
            const requestHeaders = error.config?.headers
              ? JSON.stringify(error.config.headers, null, 2)
              : '요청 헤더 정보 없음';

            let message = `🚨 **유튜브 영상 조회 403 에러 발생**\n\n`;
            message += `**시간:** ${timestamp}\n`;
            message += `**상태 코드:** ${statusCode} ${statusText}\n`;
            message += `**에러 메시지:** ${errorMessage}\n`;
            message += `**요청 URL:** ${requestUrl}\n`;
            message += `**요청 메서드:** ${requestMethod}\n\n`;

            // 응답 데이터 (1000자 제한)
            const truncatedResponseData =
              responseData.length > 1000
                ? responseData.substring(0, 1000) + '... (일부만 표시)'
                : responseData;
            message += `**응답 데이터:**\n\`\`\`json\n${truncatedResponseData}\n\`\`\`\n\n`;

            // 응답 헤더 (500자 제한)
            const truncatedResponseHeaders =
              responseHeaders.length > 500
                ? responseHeaders.substring(0, 500) + '... (일부만 표시)'
                : responseHeaders;
            message += `**응답 헤더:**\n\`\`\`json\n${truncatedResponseHeaders}\n\`\`\`\n\n`;

            // 요청 헤더 (500자 제한, 민감 정보 제거)
            const truncatedRequestHeaders =
              requestHeaders.length > 500
                ? requestHeaders.substring(0, 500) + '... (일부만 표시)'
                : requestHeaders;
            message += `**요청 헤더:**\n\`\`\`json\n${truncatedRequestHeaders}\n\`\`\`\n\n`;

            // 스택 트레이스 (500자 제한)
            if (error.stack) {
              const truncatedStack =
                error.stack.length > 500
                  ? error.stack.substring(0, 500) + '... (일부만 표시)'
                  : error.stack;
              message += `**스택 트레이스:**\n\`\`\`\n${truncatedStack}\n\`\`\`\n\n`;
            }

            message += `**참고:** 403 Forbidden 에러는 인증/권한 문제일 수 있습니다. API 키, 권한 설정, 요청 제한 등을 확인해주세요.`;

            await sendDiscordMessage(
              message,
              'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
            );
          } catch (discordError) {
            console.error('[Discord] 403 에러 알람 전송 실패:', discordError);
          }

          // 403 에러는 빈 배열로 계속 진행하지 않고 에러를 다시 throw하거나 처리 결정 필요
          // 일단 경고만 하고 빈 배열로 계속 진행 (기존 로직 유지)
          console.warn(
            `[YoutubeDailySummary] 유튜브 컨텐츠 조회 실패 (403 Forbidden). 빈 배열로 진행합니다.`,
          );
        }
        // 429 에러는 재시도 로직에서 처리되지만, 최종 실패 시에도 계속 진행
        else if (
          errorMessage.includes('429') ||
          errorMessage.includes('Rate limit')
        ) {
          console.warn(
            `[YoutubeDailySummary] 유튜브 컨텐츠 조회 실패 (429 Rate Limit). 재시도 후에도 실패하여 빈 배열로 진행합니다.`,
          );
          // 429 에러는 경고만 하고 빈 배열로 계속 진행
        } else {
          console.error(
            `[YoutubeDailySummary] 유튜브 컨텐츠 조회 실패:`,
            error,
          );
          // 다른 에러도 경고만 하고 빈 배열로 계속 진행
        }
      }

      // 24시간 내 생성된 컨텐츠 필터링
      const recentContents = allYoutubeContents.filter((content) => {
        if (!content.createdAt) {
          return false;
        }
        const createdAt = new Date(content.createdAt);
        return createdAt >= yesterday && createdAt <= now && content.content;
      });

      console.log(
        `[YoutubeDailySummary] 24시간 내 생성된 요약 컨텐츠: ${recentContents.length}개`,
      );

      // 2개 미만이면 스킵
      if (recentContents.length < 2) {
        console.log(
          `[YoutubeDailySummary] 요약 컨텐츠가 ${recentContents.length}개로 부족하여 스킵합니다.`,
        );
        // 스킵 알림 전송
        try {
          const timestamp = new Date().toISOString();
          const message = `⚠️ **데일리 서머리 작업 스킵**\n\n**시간:** ${timestamp}\n**이유:** 요약 컨텐츠가 ${recentContents.length}개로 부족합니다. (최소 2개 필요)`;
          await sendDiscordMessage(
            message,
            'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
          );
        } catch (discordError) {
          console.error('[Discord] 스킵 알림 전송 실패:', discordError);
        }
        return;
      }

      // 주제별로 그룹화
      const contentGroups = await this.groupContentsByTopic(recentContents);

      if (!contentGroups || contentGroups.length === 0) {
        console.error('[YoutubeDailySummary] 컨텐츠 그룹화 실패');
        // 그룹화 실패 알림 전송
        try {
          const timestamp = new Date().toISOString();
          const message = `⚠️ **데일리 서머리 작업 스킵**\n\n**시간:** ${timestamp}\n**이유:** 컨텐츠 그룹화 실패\n**컨텐츠 수:** ${recentContents.length}개`;
          await sendDiscordMessage(
            message,
            'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
          );
        } catch (discordError) {
          console.error('[Discord] 스킵 알림 전송 실패:', discordError);
        }
        return;
      }

      console.log(
        `[YoutubeDailySummary] ${contentGroups.length}개의 주제 그룹으로 분류됨`,
      );

      // 배치 API로 블로그 글 생성 (1개 이상이면 배치 API 사용)
      if (contentGroups.length >= 1) {
        try {
          console.log(
            `[DailySummaryBatch] 전체 ${contentGroups.length}개 그룹 블로그 글 생성 배치 작업 생성`,
          );

          // 블로그 글 생성 프로세스 시작 디스코드 알림
          try {
            const timestamp = new Date().toISOString();
            const topics = contentGroups
              .map((g) => g.topic)
              .slice(0, 5)
              .join(', ');
            const message = `🚀 **블로그 글 생성 프로세스 시작**\n\n**시간:** ${timestamp}\n**그룹 수:** ${
              contentGroups.length
            }개\n**주제:** ${topics}${contentGroups.length > 5 ? '...' : ''}`;
            await sendDiscordMessage(
              message,
              'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
            );
          } catch (discordError) {
            console.error('[Discord] 시작 알림 전송 실패:', discordError);
          }

          // 각 그룹에 대한 뉴스 검색 (비동기로 미리 수행)
          const groupsWithNews = await Promise.all(
            contentGroups.map(async (group, index) => {
              const searchQuery =
                group.topic || group.contents[0]?.title || '암호화폐 투자';
              const newsResults = await searchGoogleNews(searchQuery, 5);
              return {
                groupIndex: index,
                topic: group.topic,
                contents: group.contents,
                newsResults,
              };
            }),
          );

          const blogBatchFile = await this.createBlogBatchFile(groupsWithNews);
          await this.createBatchJob(blogBatchFile, 'blog', groupsWithNews);
          console.log(
            `[DailySummaryBatch] 블로그 글 생성 배치 작업 생성 완료. 주기적으로 상태 확인합니다.`,
          );
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : '알 수 없는 오류';
          console.error(
            `[DailySummaryBatch] 블로그 글 생성 배치 작업 생성 실패:`,
            error,
          );

          // 디스코드 알림 전송
          try {
            const timestamp = new Date().toISOString();
            const message = `🚨 **블로그 글 생성 배치 작업 생성 실패**\n\n**시간:** ${timestamp}\n**에러:** ${errorMessage}\n**그룹 수:** ${contentGroups.length}개`;
            await sendDiscordMessage(
              message,
              'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
            );
          } catch (discordError) {
            console.error('[Discord] 알람 전송 실패:', discordError);
          }

          await GlobalErrorHandler.handleError(
            error as Error,
            'YoutubeDailySummaryService.process',
          );
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      console.error('[YoutubeDailySummary] 처리 중 오류 발생:', error);

      // 디스코드 알림 전송
      try {
        const timestamp = new Date().toISOString();
        const message = `🚨 **데일리 서머리 처리 실패**\n\n**시간:** ${timestamp}\n**에러:** ${errorMessage}`;
        await sendDiscordMessage(
          message,
          'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
        );
      } catch (discordError) {
        console.error('[Discord] 알람 전송 실패:', discordError);
      }

      await GlobalErrorHandler.handleError(
        error as Error,
        'YoutubeDailySummaryService.process',
      );
    }
  }

  private async groupContentsByTopic(
    contents: YoutubeEntity[],
  ): Promise<Array<{ topic: string; contents: YoutubeEntity[] }> | null> {
    try {
      // 컨텐츠 요약 정보 준비 (채널명 제거)
      const contentsSummary = contents
        .map((content, index) => {
          return `## 컨텐츠 ${index + 1}
제목: ${content.title}
요약: ${content.summary || '요약 없음'}
본문 일부: ${content.content?.substring(0, 1500) || '본문 없음'}...`;
        })
        .join('\n\n');

      const response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: `당신은 암호화폐와 블록체인 투자 정보를 전문으로 다루는 컨텐츠 큐레이터입니다.
주어진 여러 컨텐츠들을 주제별로 그룹화해주세요. 비슷한 주제나 관련성이 높은 컨텐츠들을 하나의 그룹으로 묶어주세요.

그룹화 기준:
1. 주제의 유사성 (예: 비트코인 관련, 이더리움 관련, 시장 분석 등)
2. 관련성 (같은 이슈나 트렌드를 다루는 경우)
3. 각 그룹은 최소 2개 이상의 컨텐츠를 포함해야 함
4. 주제가 완전히 다르면 별도 그룹으로 분리
5. **중요: 최대 3개의 그룹으로만 분류하세요. 그룹이 많아지면 관련성이 높은 그룹들을 병합하여 최대 3개를 유지하세요.**

각 그룹은 명확한 주제명을 가져야 합니다.`,
          },
          {
            role: 'user',
            content: `다음 컨텐츠들을 주제별로 그룹화해주세요:

${contentsSummary}

위 컨텐츠들을 주제별로 그룹화하여 각 그룹의 주제명과 포함될 컨텐츠 번호를 알려주세요.
**중요: 최대 3개의 그룹으로만 분류하세요. 그룹이 많아지면 관련성이 높은 그룹들을 병합하여 최대 3개를 유지하세요.**`,
          },
        ],
        functions: [
          {
            name: 'group_contents_by_topic',
            description: '컨텐츠들을 주제별로 그룹화합니다.',
            parameters: {
              type: 'object',
              properties: {
                groups: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      topic: {
                        type: 'string',
                        description: '그룹의 주제명',
                      },
                      contentIndices: {
                        type: 'array',
                        items: {
                          type: 'number',
                        },
                        description:
                          '이 그룹에 포함될 컨텐츠의 인덱스 (0부터 시작)',
                      },
                    },
                    required: ['topic', 'contentIndices'],
                  },
                },
              },
              required: ['groups'],
            },
          },
        ],
        function_call: { name: 'group_contents_by_topic' },
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (!functionCall || functionCall.name !== 'group_contents_by_topic') {
        console.error('[YoutubeDailySummary] 그룹화 Function call 실패');
        return null;
      }

      // JSON 파싱 시도 (안전한 파싱)
      let args: {
        groups?: Array<{ topic: string; contentIndices: number[] }>;
      } = {};
      try {
        const argumentsStr = functionCall.arguments || '{}';
        const cleanedArgs = argumentsStr.trim();
        args = JSON.parse(cleanedArgs);
      } catch (parseError) {
        console.error(
          '[YoutubeDailySummary] 그룹화 JSON 파싱 실패:',
          parseError instanceof Error ? parseError.message : parseError,
        );
        console.error(
          '[YoutubeDailySummary] Function call arguments:',
          functionCall.arguments?.substring(0, 200),
        );
        return null;
      }

      const groups = args.groups || [];

      // 인덱스를 실제 컨텐츠로 변환
      let contentGroups = groups
        .map((group: { topic: string; contentIndices: number[] }) => ({
          topic: group.topic,
          contents: group.contentIndices
            .filter((idx: number) => idx >= 0 && idx < contents.length)
            .map((idx: number) => contents[idx]),
        }))
        .filter(
          (group: { contents: YoutubeEntity[] }) => group.contents.length >= 2,
        );

      // 최대 3개 그룹으로 제한 (초과 시 병합)
      if (contentGroups.length > 3) {
        console.log(
          `[YoutubeDailySummary] 그룹이 ${contentGroups.length}개로 너무 많아 3개로 병합합니다.`,
        );
        // 가장 작은 그룹들을 큰 그룹에 병합
        contentGroups.sort((a, b) => b.contents.length - a.contents.length); // 큰 그룹부터 정렬
        const mergedGroups = contentGroups.slice(0, 3); // 상위 3개 그룹 유지
        const remainingGroups = contentGroups.slice(3);

        // 나머지 그룹들을 상위 3개 그룹에 병합
        for (const remainingGroup of remainingGroups) {
          // 가장 작은 그룹에 병합
          mergedGroups[mergedGroups.length - 1].contents.push(
            ...remainingGroup.contents,
          );
        }

        // 병합된 그룹의 주제명 업데이트 (더 포괄적인 주제명으로)
        mergedGroups[mergedGroups.length - 1].topic = '암호화폐 투자 정보';

        contentGroups = mergedGroups;
      }

      return contentGroups.length > 0 ? contentGroups : null;
    } catch (error) {
      console.error('[YoutubeDailySummary] 컨텐츠 그룹화 실패:', error);
      await GlobalErrorHandler.handleError(
        error as Error,
        'YoutubeDailySummaryService.groupContentsByTopic',
      );
      // 그룹화 실패 시 전체를 하나의 그룹으로 처리
      return [{ topic: '암호화폐 투자 정보', contents }];
    }
  }

  private async generateDailyBlogContent(
    contents: YoutubeEntity[],
    topic?: string,
  ): Promise<{ title: string; content: string } | null> {
    try {
      // 컨텐츠 요약 정보 준비 (채널명, 유튜브 언급 완전 제거)
      const contentsSummary = contents
        .map((content, index) => {
          return `## 정보 ${index + 1}
제목: ${content.title}
요약: ${content.summary || '요약 없음'}
본문: ${content.content?.substring(0, 2000) || '본문 없음'}...`;
        })
        .join('\n\n');

      // 관련 뉴스 검색
      let newsResults: GoogleNewsResult[] = [];
      let newsSummary = '';
      const searchQuery = topic || contents[0]?.title || '암호화폐 투자';
      console.log(
        `[YoutubeDailySummary] "${searchQuery}" 관련 뉴스 검색 중...`,
      );
      newsResults = await searchGoogleNews(searchQuery, 5);
      if (newsResults.length > 0) {
        console.log(
          `[YoutubeDailySummary] ${newsResults.length}개의 관련 뉴스 발견`,
        );
        newsSummary = newsResults
          .map((news, index) => {
            return `## 뉴스 ${index + 1}
제목: ${news.title}
요약: ${news.snippet}
링크: ${news.link}
출처: ${news.source || '알 수 없음'}`;
          })
          .join('\n\n');
      }

      const systemPrompt = topic
        ? `당신은 암호화폐와 블록체인 투자 정보를 전문으로 다루는 블로그 작가입니다.
주제 "${topic}"에 관련된 여러 정보를 하나의 통합된 블로그 글로 작성해주세요.

작성 가이드:
1. 반드시 마크다운 형식으로 작성하세요 (제목은 #, ##, ### 사용, 강조는 **굵게**, *기울임* 사용)
2. 블로그 글 형태로 자연스러운 문단 형식으로 작성하세요
3. 투자자들이 궁금해할만한 매력적인 제목을 작성하세요
4. SEO 최적화를 고려한 구조화된 글 작성:
   - 명확한 제목 구조 (H1, H2, H3)
   - 관련 키워드 자연스럽게 포함
   - 메타 설명에 적합한 요약 문단 포함
   - 읽기 쉬운 문단 구조
5. 각 정보의 핵심 내용을 자연스럽게 통합하여 설명
6. 투자 관련 키워드를 자연스럽게 포함 (예: 암호화폐, 블록체인, 투자, 시장 분석 등)
7. 객관적 사실과 주관적 의견을 구분하여 작성
8. 일관된 존댓말 어투 사용 ("~했습니다", "~입니다", "~되었습니다")
9. **절대 유튜브, 채널, 영상, 출처 등의 언급을 하지 마세요. 우리의 자체 분석과 정보로 작성하세요.**

절대 금지 사항:
1. "AI로 요약했다", "이 글은 AI가 작성했습니다" 등 메타 설명 포함 금지
2. "참고 출처", "출처:", "채널", "유튜브", "영상" 등 메타 정보나 출처 언급 완전 금지
3. 단순 리스트 나열 형태(-, *, 번호)로 작성하지 마세요. 반드시 자연스러운 문단과 문장으로 설명하세요
4. 삭선(~~텍스트~~) 마크다운 형식 절대 사용 금지
5. "유튜버", "크리에이터", "채널명" 등 어떤 형태로든 출처를 암시하는 단어 사용 금지

작성 형식:
- 제목: 투자자들이 궁금해할만한 매력적인 제목 (SEO 최적화)
- 서론: 주요 내용을 간략히 소개하는 문단
- 본문: 각 정보의 핵심 내용을 자연스럽게 통합하여 설명 (우리의 분석과 관점으로)
  - 관련 뉴스 정보가 있다면 자연스럽게 본문에 통합하여 내용을 풍부하게 작성
- 결론: 주요 포인트를 요약하는 문단
- 참고 링크: 관련 뉴스 링크를 마크다운 링크 형식으로 제공
`
        : `당신은 암호화폐와 블록체인 투자 정보를 전문으로 다루는 블로그 작가입니다.
여러 투자 정보를 하나의 통합된 블로그 글로 작성해주세요.

작성 가이드:
1. 반드시 마크다운 형식으로 작성하세요 (제목은 #, ##, ### 사용, 강조는 **굵게**, *기울임* 사용)
2. 블로그 글 형태로 자연스러운 문단 형식으로 작성하세요
3. 투자자들이 궁금해할만한 매력적인 제목을 작성하세요
4. SEO 최적화를 고려한 구조화된 글 작성:
   - 명확한 제목 구조 (H1, H2, H3)
   - 관련 키워드 자연스럽게 포함
   - 메타 설명에 적합한 요약 문단 포함
   - 읽기 쉬운 문단 구조
5. 각 정보의 핵심 내용을 자연스럽게 통합하여 설명
6. 투자 관련 키워드를 자연스럽게 포함 (예: 암호화폐, 블록체인, 투자, 시장 분석 등)
7. 객관적 사실과 주관적 의견을 구분하여 작성
8. 일관된 존댓말 어투 사용 ("~했습니다", "~입니다", "~되었습니다")
9. **절대 유튜브, 채널, 영상, 출처 등의 언급을 하지 마세요. 우리의 자체 분석과 정보로 작성하세요.**

절대 금지 사항:
1. "AI로 요약했다", "이 글은 AI가 작성했습니다" 등 메타 설명 포함 금지
2. "참고 출처", "출처:", "채널", "유튜브", "영상" 등 메타 정보나 출처 언급 완전 금지
3. 단순 리스트 나열 형태(-, *, 번호)로 작성하지 마세요. 반드시 자연스러운 문단과 문장으로 설명하세요
4. 삭선(~~텍스트~~) 마크다운 형식 절대 사용 금지
5. "유튜버", "크리에이터", "채널명" 등 어떤 형태로든 출처를 암시하는 단어 사용 금지

작성 형식:
- 제목: 투자자들이 궁금해할만한 매력적인 제목 (SEO 최적화)
- 서론: 주요 내용을 간략히 소개하는 문단
- 본문: 각 정보의 핵심 내용을 자연스럽게 통합하여 설명 (우리의 분석과 관점으로)
  - 관련 뉴스 정보가 있다면 자연스럽게 본문에 통합하여 내용을 풍부하게 작성
- 결론: 주요 포인트를 요약하는 문단
- 참고 링크: 관련 뉴스 링크를 마크다운 링크 형식으로 제공 (예: [뉴스 제목](링크))`;

      const response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `다음은 오늘 수집한 투자 관련 정보들입니다. 이를 하나의 통합된 블로그 글로 작성해주세요.
우리의 자체 분석과 관점으로 작성하되, 출처나 메타 정보는 전혀 언급하지 마세요.

${contentsSummary}${
              newsSummary ? `\n\n## 관련 뉴스 정보\n\n${newsSummary}` : ''
            }

위 정보들을 바탕으로 투자자들이 궁금해할만한 제목과 내용으로 블로그 글을 작성해주세요.
${
  newsResults.length > 0
    ? `관련 뉴스 정보를 본문에 자연스럽게 통합하고, 글 마지막에 "## 참고 링크" 섹션을 추가하여 모든 뉴스 링크를 마크다운 형식([제목](링크))으로 제공해주세요.`
    : ''
}`,
          },
        ],
        functions: [
          {
            name: 'generate_daily_blog',
            description: '투자 관련 정보들을 통합한 블로그 글을 생성합니다.',
            parameters: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description:
                    '투자자들이 궁금해할만한 매력적인 제목 (SEO 최적화)',
                },
                content: {
                  type: 'string',
                  description: '정리된 전체 블로그 글 내용 (마크다운 형식)',
                },
              },
              required: ['title', 'content'],
            },
          },
        ],
        function_call: { name: 'generate_daily_blog' },
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (!functionCall || functionCall.name !== 'generate_daily_blog') {
        console.error('[YoutubeDailySummary] Function call 실패');
        return null;
      }

      // JSON 파싱 시도 (안전한 파싱)
      let args: { title?: string; content?: string } = {};
      try {
        const argumentsStr = functionCall.arguments || '{}';
        // JSON 문자열 정리 (불필요한 공백 제거, 이스케이프 처리)
        const cleanedArgs = argumentsStr.trim();
        args = JSON.parse(cleanedArgs);
      } catch (parseError) {
        console.error(
          '[YoutubeDailySummary] JSON 파싱 실패:',
          parseError instanceof Error ? parseError.message : parseError,
        );
        console.error(
          '[YoutubeDailySummary] Function call arguments:',
          functionCall.arguments?.substring(0, 200),
        );
        return null;
      }

      // content에서 삭선 제거
      if (args.content) {
        args.content = args.content.replace(/~~([^~]+)~~/g, '$1');
      }

      // 참고 링크 섹션이 없고 뉴스가 있으면 추가
      let finalContent = args.content || '';
      if (newsResults.length > 0) {
        const hasReferenceSection =
          finalContent.includes('## 참고') ||
          finalContent.includes('## 참고 링크') ||
          finalContent.includes('참고 링크');

        if (!hasReferenceSection) {
          const referenceLinks = newsResults
            .map((news) => `- [${news.title}](${news.link})`)
            .join('\n');
          finalContent += `\n\n## 참고 링크\n\n${referenceLinks}`;
        }
      }

      return {
        title: args.title || '',
        content: finalContent,
      };
    } catch (error) {
      console.error('[YoutubeDailySummary] GPT 블로그 글 생성 실패:', error);
      await GlobalErrorHandler.handleError(
        error as Error,
        'YoutubeDailySummaryService.generateDailyBlogContent',
      );
      return null;
    }
  }

  private async translateToEnglish(
    title: string,
    content: string,
  ): Promise<{ title: string; content: string } | null> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: `You are a professional translator specializing in cryptocurrency and blockchain investment content.
Translate the given Korean blog post title and content into natural, professional English.

Translation Guidelines:
1. Maintain the same markdown format (headings with #, ##, ###, bold with **, italic with *)
2. Keep the blog post style and natural paragraph format
3. Translate the title to be attractive and SEO-optimized for English-speaking investors
4. Maintain SEO-optimized structure:
   - Clear heading structure (H1, H2, H3)
   - Include relevant keywords naturally
   - Maintain readable paragraph structure
5. Translate all content naturally, preserving the meaning and tone
6. Keep investment-related keywords (e.g., cryptocurrency, blockchain, investment, market analysis)
7. Maintain consistent formal tone
8. **Never mention YouTube, channels, videos, or any source references. Write as our own analysis and information.**

Absolute Prohibitions:
1. Do not include meta descriptions like "This was summarized by AI" or "This article was written by AI"
2. Do not include meta information like "Reference source", "Source:", "Channel", "YouTube", "Video"
3. Do not use simple list format (-, *, numbers). Always use natural paragraphs and sentences
4. Never use strikethrough markdown format (~~text~~)
5. Do not use any words that imply sources like "YouTuber", "Creator", "Channel name"

Translation Format:
- Title: Attractive title that investors would be curious about (SEO optimized)
- Introduction: Brief introduction paragraph of main content
- Body: Natural integration of core content from each information (as our own analysis and perspective)
- Conclusion: Summary paragraph of main points
- Reference Links: Provide reference news links in markdown format ([Title](Link))`,
          },
          {
            role: 'user',
            content: `Translate the following Korean blog post to English:

Title: ${title}

Content:
${content}

Please translate the title and content to natural, professional English while maintaining the markdown format and structure.`,
          },
        ],
        functions: [
          {
            name: 'translate_blog_to_english',
            description:
              'Translates Korean blog post to English while maintaining structure and format.',
            parameters: {
              type: 'object',
              properties: {
                title: {
                  type: 'string',
                  description:
                    'Translated English title (SEO optimized, attractive to investors)',
                },
                content: {
                  type: 'string',
                  description:
                    'Translated English blog post content (markdown format)',
                },
              },
              required: ['title', 'content'],
            },
          },
        ],
        function_call: { name: 'translate_blog_to_english' },
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (!functionCall || functionCall.name !== 'translate_blog_to_english') {
        console.error('[YoutubeDailySummary] 번역 Function call 실패');
        return null;
      }

      // JSON 파싱 시도 (안전한 파싱)
      let args: { title?: string; content?: string } = {};
      try {
        const argumentsStr = functionCall.arguments || '{}';
        const cleanedArgs = argumentsStr.trim();
        args = JSON.parse(cleanedArgs);
      } catch (parseError) {
        console.error(
          '[YoutubeDailySummary] 번역 JSON 파싱 실패:',
          parseError instanceof Error ? parseError.message : parseError,
        );
        console.error(
          '[YoutubeDailySummary] Function call arguments:',
          functionCall.arguments?.substring(0, 200),
        );
        return null;
      }

      // content에서 삭선 제거
      if (args.content) {
        args.content = args.content.replace(/~~([^~]+)~~/g, '$1');
      }

      return {
        title: args.title || '',
        content: args.content || '',
      };
    } catch (error) {
      console.error('[YoutubeDailySummary] 영어 번역 실패:', error);
      await GlobalErrorHandler.handleError(
        error as Error,
        'YoutubeDailySummaryService.translateToEnglish',
      );
      return null;
    }
  }

  // 배치 파일 생성 (블로그 글 생성 요청)
  private async createBlogBatchFile(
    groups: Array<{
      groupIndex: number;
      topic: string;
      contents: YoutubeEntity[];
      newsResults?: GoogleNewsResult[];
    }>,
  ): Promise<string> {
    const batchFilePath = `daily-summary-blog-batch-${Date.now()}.jsonl`;
    const rows: Array<{
      custom_id: string;
      method: string;
      url: string;
      body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
    }> = [];

    for (const group of groups) {
      // 컨텐츠 요약 정보 준비
      const contentsSummary = group.contents
        .map((content, index) => {
          return `## 정보 ${index + 1}
제목: ${content.title}
요약: ${content.summary || '요약 없음'}
본문: ${content.content?.substring(0, 2000) || '본문 없음'}...`;
        })
        .join('\n\n');

      // 뉴스 요약 정보 준비
      let newsSummary = '';
      if (group.newsResults && group.newsResults.length > 0) {
        newsSummary = group.newsResults
          .map((news, index) => {
            return `## 뉴스 ${index + 1}
제목: ${news.title}
요약: ${news.snippet}
링크: ${news.link}
출처: ${news.source || '알 수 없음'}`;
          })
          .join('\n\n');
      }

      const systemPrompt = group.topic
        ? `당신은 암호화폐와 블록체인 투자 정보를 전문으로 다루는 블로그 작가입니다.
주제 "${group.topic}"에 관련된 여러 정보를 하나의 통합된 블로그 글로 작성해주세요.

작성 가이드:
1. 반드시 마크다운 형식으로 작성하세요 (제목은 #, ##, ### 사용, 강조는 **굵게**, *기울임* 사용)
2. 블로그 글 형태로 자연스러운 문단 형식으로 작성하세요
3. 투자자들이 궁금해할만한 매력적인 제목을 작성하세요
4. SEO 최적화를 고려한 구조화된 글 작성:
   - 명확한 제목 구조 (H1, H2, H3)
   - 관련 키워드 자연스럽게 포함
   - 메타 설명에 적합한 요약 문단 포함
   - 읽기 쉬운 문단 구조
5. 각 정보의 핵심 내용을 자연스럽게 통합하여 설명
6. 투자 관련 키워드를 자연스럽게 포함 (예: 암호화폐, 블록체인, 투자, 시장 분석 등)
7. 객관적 사실과 주관적 의견을 구분하여 작성
8. 일관된 존댓말 어투 사용 ("~했습니다", "~입니다", "~되었습니다")
9. **절대 유튜브, 채널, 영상, 출처 등의 언급을 하지 마세요. 우리의 자체 분석과 정보로 작성하세요.**

절대 금지 사항:
1. "AI로 요약했다", "이 글은 AI가 작성했습니다" 등 메타 설명 포함 금지
2. "참고 출처", "출처:", "채널", "유튜브", "영상" 등 메타 정보나 출처 언급 완전 금지
3. 단순 리스트 나열 형태(-, *, 번호)로 작성하지 마세요. 반드시 자연스러운 문단과 문장으로 설명하세요
4. 삭선(~~텍스트~~) 마크다운 형식 절대 사용 금지
5. "유튜버", "크리에이터", "채널명" 등 어떤 형태로든 출처를 암시하는 단어 사용 금지

작성 형식:
- 제목: 투자자들이 궁금해할만한 매력적인 제목 (SEO 최적화)
- 서론: 주요 내용을 간략히 소개하는 문단
- 본문: 각 정보의 핵심 내용을 자연스럽게 통합하여 설명 (우리의 분석과 관점으로)
  - 관련 뉴스 정보가 있다면 자연스럽게 본문에 통합하여 내용을 풍부하게 작성
- 결론: 주요 포인트를 요약하는 문단
- 참고 링크: 관련 뉴스 링크를 마크다운 링크 형식으로 제공
`
        : `당신은 암호화폐와 블록체인 투자 정보를 전문으로 다루는 블로그 작가입니다.
여러 투자 정보를 하나의 통합된 블로그 글로 작성해주세요.

작성 가이드:
1. 반드시 마크다운 형식으로 작성하세요 (제목은 #, ##, ### 사용, 강조는 **굵게**, *기울임* 사용)
2. 블로그 글 형태로 자연스러운 문단 형식으로 작성하세요
3. 투자자들이 궁금해할만한 매력적인 제목을 작성하세요
4. SEO 최적화를 고려한 구조화된 글 작성:
   - 명확한 제목 구조 (H1, H2, H3)
   - 관련 키워드 자연스럽게 포함
   - 메타 설명에 적합한 요약 문단 포함
   - 읽기 쉬운 문단 구조
5. 각 정보의 핵심 내용을 자연스럽게 통합하여 설명
6. 투자 관련 키워드를 자연스럽게 포함 (예: 암호화폐, 블록체인, 투자, 시장 분석 등)
7. 객관적 사실과 주관적 의견을 구분하여 작성
8. 일관된 존댓말 어투 사용 ("~했습니다", "~입니다", "~되었습니다")
9. **절대 유튜브, 채널, 영상, 출처 등의 언급을 하지 마세요. 우리의 자체 분석과 정보로 작성하세요.**

절대 금지 사항:
1. "AI로 요약했다", "이 글은 AI가 작성했습니다" 등 메타 설명 포함 금지
2. "참고 출처", "출처:", "채널", "유튜브", "영상" 등 메타 정보나 출처 언급 완전 금지
3. 단순 리스트 나열 형태(-, *, 번호)로 작성하지 마세요. 반드시 자연스러운 문단과 문장으로 설명하세요
4. 삭선(~~텍스트~~) 마크다운 형식 절대 사용 금지
5. "유튜버", "크리에이터", "채널명" 등 어떤 형태로든 출처를 암시하는 단어 사용 금지

작성 형식:
- 제목: 투자자들이 궁금해할만한 매력적인 제목 (SEO 최적화)
- 서론: 주요 내용을 간략히 소개하는 문단
- 본문: 각 정보의 핵심 내용을 자연스럽게 통합하여 설명 (우리의 분석과 관점으로)
  - 관련 뉴스 정보가 있다면 자연스럽게 본문에 통합하여 내용을 풍부하게 작성
- 결론: 주요 포인트를 요약하는 문단
- 참고 링크: 관련 뉴스 링크를 마크다운 링크 형식으로 제공 (예: [뉴스 제목](링크))`;

      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
        {
          model: 'gpt-5',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: `다음은 오늘 수집한 투자 관련 정보들입니다. 이를 하나의 통합된 블로그 글로 작성해주세요.
우리의 자체 분석과 관점으로 작성하되, 출처나 메타 정보는 전혀 언급하지 마세요.

${contentsSummary}${
                newsSummary ? `\n\n## 관련 뉴스 정보\n\n${newsSummary}` : ''
              }

위 정보들을 바탕으로 투자자들이 궁금해할만한 제목과 내용으로 블로그 글을 작성해주세요.
${
  group.newsResults && group.newsResults.length > 0
    ? `관련 뉴스 정보를 본문에 자연스럽게 통합하고, 글 마지막에 "## 참고 링크" 섹션을 추가하여 모든 뉴스 링크를 마크다운 형식([제목](링크))으로 제공해주세요.`
    : ''
}`,
            },
          ],
          functions: [
            {
              name: 'generate_daily_blog',
              description: '투자 관련 정보들을 통합한 블로그 글을 생성합니다.',
              parameters: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description:
                      '투자자들이 궁금해할만한 매력적인 제목 (SEO 최적화)',
                  },
                  content: {
                    type: 'string',
                    description: '정리된 전체 블로그 글 내용 (마크다운 형식)',
                  },
                },
                required: ['title', 'content'],
              },
            },
          ],
          function_call: { name: 'generate_daily_blog' },
        };

      rows.push({
        custom_id: `blog-${group.groupIndex}`,
        method: 'POST',
        url: '/v1/chat/completions',
        body,
      });
    }

    const text = rows.map((row) => JSON.stringify(row)).join('\n');
    fs.writeFileSync(batchFilePath, text, { encoding: 'utf8' });
    return batchFilePath;
  }

  // 배치 파일 생성 (번역 요청)
  private async createTranslationBatchFile(
    translations: Array<{
      groupIndex: number;
      title: string;
      content: string;
    }>,
  ): Promise<string> {
    const batchFilePath = `daily-summary-translation-batch-${Date.now()}.jsonl`;
    const rows: Array<{
      custom_id: string;
      method: string;
      url: string;
      body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;
    }> = [];

    for (const translation of translations) {
      const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
        {
          model: 'gpt-5',
          messages: [
            {
              role: 'system',
              content: `You are a professional translator specializing in cryptocurrency and blockchain investment content.
Translate the given Korean blog post title and content into natural, professional English.

Translation Guidelines:
1. Maintain the same markdown format (headings with #, ##, ###, bold with **, italic with *)
2. Keep the blog post style and natural paragraph format
3. Translate the title to be attractive and SEO-optimized for English-speaking investors
4. Maintain SEO-optimized structure:
   - Clear heading structure (H1, H2, H3)
   - Include relevant keywords naturally
   - Maintain readable paragraph structure
5. Translate all content naturally, preserving the meaning and tone
6. Keep investment-related keywords (e.g., cryptocurrency, blockchain, investment, market analysis)
7. Maintain consistent formal tone
8. **Never mention YouTube, channels, videos, or any source references. Write as our own analysis and information.**

Absolute Prohibitions:
1. Do not include meta descriptions like "This was summarized by AI" or "This article was written by AI"
2. Do not include meta information like "Reference source", "Source:", "Channel", "YouTube", "Video"
3. Do not use simple list format (-, *, numbers). Always use natural paragraphs and sentences
4. Never use strikethrough markdown format (~~text~~)
5. Do not use any words that imply sources like "YouTuber", "Creator", "Channel name"

Translation Format:
- Title: Attractive title that investors would be curious about (SEO optimized)
- Introduction: Brief introduction paragraph of main content
- Body: Natural integration of core content from each information (as our own analysis and perspective)
- Conclusion: Summary paragraph of main points
- Reference Links: Provide reference news links in markdown format ([Title](Link))`,
            },
            {
              role: 'user',
              content: `Translate the following Korean blog post to English:

Title: ${translation.title}

Content:
${translation.content}

Please translate the title and content to natural, professional English while maintaining the markdown format and structure.`,
            },
          ],
          functions: [
            {
              name: 'translate_blog_to_english',
              description:
                'Translates Korean blog post to English while maintaining structure and format.',
              parameters: {
                type: 'object',
                properties: {
                  title: {
                    type: 'string',
                    description:
                      'Translated English title (SEO optimized, attractive to investors)',
                  },
                  content: {
                    type: 'string',
                    description:
                      'Translated English blog post content (markdown format)',
                  },
                },
                required: ['title', 'content'],
              },
            },
          ],
          function_call: { name: 'translate_blog_to_english' },
        };

      rows.push({
        custom_id: `translation-${translation.groupIndex}`,
        method: 'POST',
        url: '/v1/chat/completions',
        body,
      });
    }

    const text = rows.map((row) => JSON.stringify(row)).join('\n');
    fs.writeFileSync(batchFilePath, text, { encoding: 'utf8' });
    return batchFilePath;
  }

  // 배치 작업 생성
  private async createBatchJob(
    batchFilePath: string,
    jobType: 'blog' | 'translation',
    groups: Array<{
      groupIndex: number;
      topic: string;
      contents: YoutubeEntity[];
      newsResults?: GoogleNewsResult[];
    }>,
    blogResults?: Map<
      number,
      { title: string; content: string; thumbnail?: string }
    >,
  ): Promise<string> {
    try {
      // 배치 파일 검증
      const fileStats = fs.statSync(batchFilePath);
      const fileSizeMB = fileStats.size / (1024 * 1024);
      console.log(
        `[DailySummaryBatch] ${jobType} 배치 파일 크기: ${fileSizeMB.toFixed(
          2,
        )}MB`,
      );

      const fileContent = fs.readFileSync(batchFilePath, 'utf8');
      const lines = fileContent.split('\n').filter((line) => line.trim());
      console.log(
        `[DailySummaryBatch] ${jobType} 배치 파일 라인 수: ${lines.length}`,
      );

      if (lines.length === 0) {
        throw new Error('배치 파일이 비어있습니다.');
      }

      // 첫 번째 라인이 유효한 JSON인지 확인
      try {
        JSON.parse(lines[0]);
      } catch (e) {
        throw new Error(
          `배치 파일 형식 오류: 첫 번째 라인이 유효한 JSON이 아닙니다.`,
        );
      }

      // 1. 파일 업로드
      const file = await this.openai.files.create({
        file: fs.createReadStream(batchFilePath, { encoding: 'utf8' }),
        purpose: 'batch',
      });
      console.log(
        `[DailySummaryBatch] ${jobType} 파일 업로드 완료. File ID: ${file.id}`,
      );

      // 2. 배치 작업 생성
      const batchJob = await this.openai.batches.create({
        input_file_id: file.id,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
      });

      console.log(
        `[DailySummaryBatch] ${jobType} 배치 작업 생성 완료. ID: ${batchJob.id}`,
      );

      // 3. 캐시에 저장
      const cacheEntry: BatchJobCache = {
        jobId: batchJob.id,
        jobType,
        status: 'pending',
        createdAt: new Date().toISOString(),
        groups,
        batchFilePath,
        blogResults,
      };
      this.addBatchJobToCache(cacheEntry);

      return batchJob.id;
    } catch (error) {
      // 임시 파일 삭제
      try {
        fs.unlinkSync(batchFilePath);
      } catch (e) {
        // 파일 삭제 실패는 무시
      }
      await GlobalErrorHandler.handleError(
        error as Error,
        'YoutubeDailySummaryService.createBatchJob',
        { batchFilePath, jobType },
      );
      throw error;
    }
  }

  // 디스코드 성공 알람 전송
  private async sendSuccessAlert(
    job: BatchJobCache,
    successCount?: number,
    failureCount?: number,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      let message = `✅ **데일리 서머리 배치 작업 성공**\n\n`;
      message += `**시간:** ${timestamp}\n`;
      message += `**작업 유형:** ${
        job.jobType === 'blog' ? '블로그 글 생성' : '번역'
      }\n`;
      message += `**작업 ID:** ${job.jobId}\n`;
      message += `**그룹 수:** ${job.groups.length}개\n`;

      if (successCount !== undefined || failureCount !== undefined) {
        message += `**성공:** ${successCount ?? 0}개\n`;
        if (failureCount !== undefined && failureCount > 0) {
          message += `**실패:** ${failureCount}개 ⚠️\n`;
        }
      }

      if (job.jobType === 'blog') {
        message += `**상태:** 블로그 글 생성 완료\n`;
      } else if (job.jobType === 'translation') {
        message += `**상태:** 번역 완료\n`;
      }

      await sendDiscordMessage(
        message,
        'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
      );
    } catch (error) {
      console.error('[Discord] 성공 알람 전송 실패:', error);
    }
  }

  // 디스코드 실패 알람 전송
  private async sendFailureAlert(
    job: BatchJobCache,
    status: string,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      let message = `🚨 **데일리 서머리 배치 작업 실패**\n\n`;
      message += `**시간:** ${timestamp}\n`;
      message += `**작업 유형:** ${
        job.jobType === 'blog' ? '블로그 글 생성' : '번역'
      }\n`;
      message += `**작업 ID:** ${job.jobId}\n`;
      message += `**그룹 수:** ${job.groups.length}개\n`;
      message += `**실패 상태:** ${status}\n`;

      if (job.jobType === 'blog') {
        message += `**영향:** 블로그 글 생성 실패\n`;
      } else if (job.jobType === 'translation') {
        message += `**영향:** 번역 실패\n`;
      }

      message += `\n**참고:** 배치 작업이 실패했습니다. 로그를 확인해주세요.`;

      await sendDiscordMessage(
        message,
        'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
      );
    } catch (error) {
      console.error('[Discord] 실패 알람 전송 실패:', error);
    }
  }

  // 배치 작업 상태 확인 및 처리
  async checkAndProcessBatchJobs(): Promise<void> {
    const cache = this.readBatchCache();
    const pendingJobs = cache.filter(
      (job) => job.status === 'pending' || job.status === 'processing',
    );

    // 썸네일 배치 작업이 있는 블로그 작업도 확인
    const jobsWithThumbnails = cache.filter(
      (job) =>
        job.jobType === 'blog' &&
        job.thumbnailJobId &&
        job.thumbnailStatus &&
        Array.from(job.thumbnailStatus.values()).some(
          (status) => status === 'pending' || status === 'processing',
        ),
    );

    if (pendingJobs.length === 0 && jobsWithThumbnails.length === 0) {
      return;
    }

    console.log(
      `[DailySummaryBatch] 처리 중인 배치 작업 ${pendingJobs.length}개, 썸네일 배치 작업 ${jobsWithThumbnails.length}개 확인`,
    );

    // OpenAI 배치 작업 확인
    for (const job of pendingJobs) {
      try {
        const batchJob = await this.openai.batches.retrieve(job.jobId);
        console.log(
          `[DailySummaryBatch] ${job.jobType} 작업 ${job.jobId} 상태: ${batchJob.status}`,
        );

        if (batchJob.status === 'completed') {
          this.updateBatchJobCache(job.jobId, { status: 'completed' });
          try {
            await this.processBatchJobResults(job);
            // 성공 알람 (processBatchJobResults 내부에서 상세 알림을 보내므로 여기서는 간단히)
            await this.sendSuccessAlert(job);
          } catch (error) {
            console.error(
              `[DailySummaryBatch] 배치 작업 결과 처리 중 오류: ${job.jobId}`,
              error,
            );
            // 결과 처리 실패 알림
            await this.sendFailureAlert(job, '결과 처리 실패');
          }
        } else if (
          batchJob.status === 'failed' ||
          batchJob.status === 'cancelled' ||
          batchJob.status === 'expired'
        ) {
          this.updateBatchJobCache(job.jobId, { status: 'failed' });
          console.error(
            `[DailySummaryBatch] ${job.jobType} 작업 ${job.jobId} 실패: ${batchJob.status}`,
          );
          // 실패 알람
          await this.sendFailureAlert(job, batchJob.status);
          this.removeBatchJobFromCache(job.jobId);
        } else if (
          batchJob.status === 'in_progress' ||
          batchJob.status === 'finalizing' ||
          batchJob.status === 'validating'
        ) {
          this.updateBatchJobCache(job.jobId, { status: 'processing' });
        }
      } catch (error) {
        console.error(
          `[DailySummaryBatch] 배치 작업 상태 확인 실패: ${job.jobId}`,
          error,
        );
        await GlobalErrorHandler.handleError(
          error as Error,
          'YoutubeDailySummaryService.checkAndProcessBatchJobs',
          { jobId: job.jobId },
        );
      }
    }

    // Gemini 썸네일 배치 작업 확인
    for (const job of jobsWithThumbnails) {
      if (!job.thumbnailJobId) continue;

      try {
        const thumbnailBatchJob =
          await this.geminiImageBatchService.getBatchJob(job.thumbnailJobId);

        const state = thumbnailBatchJob.state;
        console.log(
          `[DailySummaryBatch] 썸네일 배치 작업 ${job.thumbnailJobId} 상태: ${state}`,
        );

        if (
          state === JobState.JOB_STATE_SUCCEEDED ||
          state === JobState.JOB_STATE_PARTIALLY_SUCCEEDED
        ) {
          // 썸네일 배치 작업 완료 - 결과 처리
          await this.processThumbnailBatchResults(job, thumbnailBatchJob);
        } else if (
          state === JobState.JOB_STATE_FAILED ||
          state === JobState.JOB_STATE_CANCELLED
        ) {
          // 썸네일 배치 작업 실패
          console.error(
            `[DailySummaryBatch] 썸네일 배치 작업 ${job.thumbnailJobId} 실패: ${state}`,
          );
          if (job.thumbnailStatus) {
            job.thumbnailStatus.forEach((_, groupIndex) => {
              if (job.thumbnailStatus) {
                job.thumbnailStatus.set(groupIndex, 'failed');
              }
            });
            this.updateBatchJobCache(job.jobId, {
              thumbnailStatus: job.thumbnailStatus,
            });
          }

          // 썸네일 실패해도 영어 번역은 생성해야 함
          if (job.blogResults && job.blogResults.size > 0) {
            // 번역이 이미 생성되었는지 확인 (중복 방지)
            // 같은 블로그 작업에서 생성된 번역 작업이 있는지 확인
            const existingTranslationJobs = this.readBatchCache().filter(
              (cachedJob) =>
                cachedJob.jobType === 'translation' &&
                cachedJob.sourceBlogJobId === job.jobId &&
                (cachedJob.status === 'pending' ||
                  cachedJob.status === 'processing'),
            );

            if (existingTranslationJobs.length === 0) {
              console.log(
                `[DailySummaryBatch] 썸네일 실패 후 모든 블로그(${job.blogResults.size}개)에 대해 영어 번역 배치 작업 생성`,
              );
              try {
                const translations = Array.from(job.blogResults.entries()).map(
                  ([groupIndex, blog]) => ({
                    groupIndex,
                    title: blog.title,
                    content: blog.content,
                  }),
                );

                const translationBatchFile =
                  await this.createTranslationBatchFile(translations);
                const translationJobId = await this.createBatchJob(
                  translationBatchFile,
                  'translation',
                  job.groups,
                  job.blogResults,
                );

                // 번역 작업에 원본 블로그 작업 ID 저장
                this.updateBatchJobCache(translationJobId, {
                  sourceBlogJobId: job.jobId,
                });

                console.log(
                  `[DailySummaryBatch] 영어 번역 배치 작업 생성 완료: ${translationJobId}`,
                );
              } catch (error) {
                console.error(
                  `[DailySummaryBatch] 영어 번역 배치 작업 생성 실패:`,
                  error,
                );
                // 번역 실패해도 계속 진행
              }
            } else {
              console.log(
                `[DailySummaryBatch] 번역 배치 작업이 이미 존재하여 스킵합니다. (기존 작업: ${existingTranslationJobs
                  .map((j) => j.jobId)
                  .join(', ')})`,
              );
            }
          }

          // 디스코드 알림 전송
          try {
            const timestamp = new Date().toISOString();
            const failedCount = job.thumbnailStatus
              ? Array.from(job.thumbnailStatus.values()).filter(
                  (s) => s === 'failed',
                ).length
              : 0;
            const message = `🚨 **썸네일 배치 작업 실패**\n\n**시간:** ${timestamp}\n**작업 ID:** ${job.thumbnailJobId}\n**상태:** ${state}\n**실패한 썸네일:** ${failedCount}개\n**참고:** 썸네일 없이 블로그 글은 계속 진행됩니다.`;
            await sendDiscordMessage(
              message,
              'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
            );
          } catch (discordError) {
            console.error(
              '[Discord] 썸네일 실패 알람 전송 실패:',
              discordError,
            );
          }
        }
      } catch (error) {
        console.error(
          `[DailySummaryBatch] 썸네일 배치 작업 상태 확인 실패: ${job.thumbnailJobId}`,
          error,
        );
      }
    }
  }

  // 썸네일 배치 작업 결과 처리
  private async processThumbnailBatchResults(
    job: BatchJobCache,
    thumbnailBatchJob: BatchJob,
  ): Promise<void> {
    if (!job.blogResults || !job.thumbnailStatus || !job.thumbnailUrls) {
      console.error(
        `[DailySummaryBatch] 썸네일 배치 결과 처리 실패: 필요한 데이터가 없습니다.`,
      );
      return;
    }

    try {
      console.log(
        `[DailySummaryBatch] 썸네일 배치 결과 처리 시작: ${thumbnailBatchJob.name}`,
      );

      // GCS Eventual Consistency 대응: 완료 후 15초 대기
      console.log(`[DailySummaryBatch] GCS 파일 가시성 대기: 15초 대기 중...`);
      await new Promise((resolve) => setTimeout(resolve, 15000));

      // 썸네일 배치 결과 가져오기 (재시도 로직 포함)
      let thumbnailResults;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          thumbnailResults =
            await this.geminiImageBatchService.processBatchResults(
              thumbnailBatchJob,
              Array.from(job.blogResults.keys()).map((groupIndex) => ({
                key: `thumbnail-${groupIndex}`,
                prompt: '', // 실제로는 사용되지 않음
              })),
            );
          break; // 성공하면 루프 종료
        } catch (error: unknown) {
          retryCount++;
          const errorMessage =
            error instanceof Error ? error.message : '알 수 없는 오류';

          if (retryCount < maxRetries) {
            const waitTime = retryCount * 5; // 5초, 10초, 15초
            console.warn(
              `[DailySummaryBatch] 썸네일 배치 결과 가져오기 실패 (재시도 ${retryCount}/${maxRetries}): ${errorMessage}`,
            );
            console.log(`[DailySummaryBatch] ${waitTime}초 후 재시도합니다...`);
            await new Promise((resolve) =>
              setTimeout(resolve, waitTime * 1000),
            );
          } else {
            console.error(
              `[DailySummaryBatch] 썸네일 배치 결과 가져오기 최종 실패: ${errorMessage}`,
            );
            throw error;
          }
        }
      }

      if (!thumbnailResults) {
        throw new Error('썸네일 배치 결과를 가져올 수 없습니다.');
      }

      // 썸네일 결과를 그룹에 매칭
      const thumbnailMap = new Map<number, string | null>();
      if (!job.thumbnailStatus || !job.thumbnailUrls) {
        console.error(
          `[DailySummaryBatch] 썸네일 상태가 초기화되지 않았습니다.`,
        );
        return;
      }

      for (const result of thumbnailResults) {
        if (result.success && result.imageUrl && result.key) {
          const match = result.key.match(/^thumbnail-(.+)$/);
          if (match) {
            const groupIndex = Number(match[1]);
            thumbnailMap.set(groupIndex, result.imageUrl);
            job.thumbnailStatus.set(groupIndex, 'completed');
            job.thumbnailUrls.set(groupIndex, result.imageUrl);
          }
        } else if (result.key) {
          const match = result.key.match(/^thumbnail-(.+)$/);
          if (match) {
            const groupIndex = Number(match[1]);
            thumbnailMap.set(groupIndex, null);
            job.thumbnailStatus.set(groupIndex, 'failed');
          }
        }
      }

      // 블로그 글에 썸네일 추가 및 업데이트
      const updatedBlogs = new Map<
        number,
        { title: string; content: string; thumbnail?: string }
      >();
      let updatedCount = 0;
      for (const [groupIndex, blog] of job.blogResults.entries()) {
        const thumbnailUrl = thumbnailMap.get(groupIndex);

        if (thumbnailUrl) {
          // 썸네일이 이미 포함되어 있는지 확인
          if (!blog.content.includes(thumbnailUrl)) {
            const updatedContent = `![썸네일](${thumbnailUrl})\n\n${blog.content}`;
            const updatedBlog = {
              title: blog.title,
              content: updatedContent,
              thumbnail: thumbnailUrl,
            };
            job.blogResults.set(groupIndex, updatedBlog);
            updatedBlogs.set(groupIndex, updatedBlog);

            // 블로그 글 업데이트 (썸네일 포함하여 다시 저장)
            // 주의: createBlog는 새 글을 생성하므로, API가 중복을 처리하는지 확인 필요
            // 만약 중복이 생성된다면, updateBlog API를 사용하거나 중복 체크 로직 추가 필요
            try {
              await createBlog({
                title: updatedBlog.title,
                content: updatedBlog.content,
                author: 'Web3 Scan',
                lang: 'ko',
                thumbnail: thumbnailUrl,
              });
              console.log(
                `[DailySummaryBatch] 썸네일 추가된 블로그 글 저장 완료: ${updatedBlog.title}`,
              );
              updatedCount++;
            } catch (error) {
              console.error(
                `[DailySummaryBatch] 썸네일 추가된 블로그 글 저장 실패: ${updatedBlog.title}`,
                error,
              );
              // 중복 에러인 경우 경고만 (API가 중복을 처리하는 경우)
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              if (
                errorMessage.includes('duplicate') ||
                errorMessage.includes('중복') ||
                errorMessage.includes('already exists')
              ) {
                console.log(
                  `[DailySummaryBatch] 블로그 글 중복 감지 (정상): ${updatedBlog.title}`,
                );
              }
            }
          }
        } else {
          console.log(
            `[DailySummaryBatch] 썸네일 생성 실패 (${groupIndex}), 썸네일 없이 진행`,
          );
          // 썸네일 생성 실패 알림 (크레딧 낭비 방지를 위해 경고만, 개별 실패는 집계하여 한 번만 알림)
        }
      }

      // 상태 저장
      this.updateBatchJobCache(job.jobId, {
        blogResults: job.blogResults,
        thumbnailStatus: job.thumbnailStatus,
        thumbnailUrls: job.thumbnailUrls,
      });

      // 모든 블로그에 대해 영어 버전 번역 생성
      // 썸네일이 추가된 블로그와 추가되지 않은 블로그 모두 포함
      if (job.blogResults && job.blogResults.size > 0) {
        // 번역이 이미 생성되었는지 확인 (중복 방지)
        // 같은 블로그 작업에서 생성된 번역 작업이 있는지 확인
        const existingTranslationJobs = this.readBatchCache().filter(
          (cachedJob) =>
            cachedJob.jobType === 'translation' &&
            cachedJob.sourceBlogJobId === job.jobId &&
            (cachedJob.status === 'pending' ||
              cachedJob.status === 'processing'),
        );

        if (existingTranslationJobs.length === 0) {
          console.log(
            `[DailySummaryBatch] 모든 블로그(${job.blogResults.size}개)에 대해 영어 번역 배치 작업 생성`,
          );
          try {
            const translations = Array.from(job.blogResults.entries()).map(
              ([groupIndex, blog]) => ({
                groupIndex,
                title: blog.title,
                content: blog.content,
              }),
            );

            const translationBatchFile = await this.createTranslationBatchFile(
              translations,
            );
            const translationJobId = await this.createBatchJob(
              translationBatchFile,
              'translation',
              job.groups,
              job.blogResults,
            );

            // 번역 작업에 원본 블로그 작업 ID 저장
            this.updateBatchJobCache(translationJobId, {
              sourceBlogJobId: job.jobId,
            });

            console.log(
              `[DailySummaryBatch] 영어 번역 배치 작업 생성 완료: ${translationJobId}`,
            );
          } catch (error) {
            console.error(
              `[DailySummaryBatch] 영어 번역 배치 작업 생성 실패:`,
              error,
            );
            // 번역 실패해도 계속 진행
          }
        } else {
          console.log(
            `[DailySummaryBatch] 번역 배치 작업이 이미 존재하여 스킵합니다. (기존 작업: ${existingTranslationJobs
              .map((j) => j.jobId)
              .join(', ')})`,
          );
        }
      }

      // 썸네일 생성 실패 집계 및 알림
      if (job.thumbnailStatus) {
        const failedCount = Array.from(job.thumbnailStatus.values()).filter(
          (s) => s === 'failed',
        ).length;
        if (failedCount > 0) {
          try {
            const timestamp = new Date().toISOString();
            const message = `⚠️ **썸네일 생성 실패**\n\n**시간:** ${timestamp}\n**작업 ID:** ${job.jobId}\n**실패한 썸네일:** ${failedCount}개\n**성공한 썸네일:** ${updatedCount}개\n**참고:** 실패한 썸네일은 없이 블로그 글이 저장됩니다.`;
            await sendDiscordMessage(
              message,
              'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
            );
          } catch (discordError) {
            console.error(
              '[Discord] 썸네일 실패 알람 전송 실패:',
              discordError,
            );
          }
        }
      }

      console.log(
        `[DailySummaryBatch] 썸네일 배치 결과 처리 완료: ${updatedCount}개 블로그 글 업데이트`,
      );
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      console.error(`[DailySummaryBatch] 썸네일 배치 결과 처리 실패:`, error);

      // 디스코드 알림 전송
      try {
        const timestamp = new Date().toISOString();
        const message = `🚨 **썸네일 배치 결과 처리 실패**\n\n**시간:** ${timestamp}\n**작업 ID:** ${job.jobId}\n**썸네일 작업 ID:** ${thumbnailBatchJob.name}\n**에러:** ${errorMessage}`;
        await sendDiscordMessage(
          message,
          'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
        );
      } catch (discordError) {
        console.error(
          '[Discord] 썸네일 처리 실패 알람 전송 실패:',
          discordError,
        );
      }

      await GlobalErrorHandler.handleError(
        error as Error,
        'YoutubeDailySummaryService.processThumbnailBatchResults',
        { jobId: job.jobId, thumbnailJobId: thumbnailBatchJob.name },
      );
    }
  }

  // AI 이미지 생성 및 업로드 (Gemini 사용)
  private async generateAndUploadImage(
    topic: string,
    contentSummary: string,
    lang: 'ko' | 'en' = 'ko',
  ): Promise<string | null> {
    return this.geminiImageService.generateAndUploadImage({
      topic,
      contentSummary,
      lang,
    });
  }

  /**
   * AI를 사용하여 썸네일 이미지 생성을 위한 프롬프트를 생성합니다.
   * 신뢰감 있는, 언론사 느낌으로, 클릭하고 싶은 썸네일 (텍스트 없이)
   */
  private async buildThumbnailPrompt(
    title: string,
    content: string,
    lang: 'ko' | 'en' = 'ko',
  ): Promise<string> {
    const contentSummary = content.substring(0, 2000);

    const systemPrompt =
      lang === 'en'
        ? `You are an expert in analyzing blog content and generating appropriate thumbnail image prompts.
Read the given blog post title and content, and create a prompt for generating a thumbnail image that accurately reflects the content.

Prompt Creation Guidelines:
1. Accurately analyze the actual content and topic of the blog post
2. Identify the core concepts, technologies, and topics covered in the article
3. Suggest specific thumbnails that match the actual content of the article, not generic cryptocurrency imagery
4. Suggest professional, trustworthy editorial-style thumbnails
5. Suggest bold and attractive designs that make people want to click
6. Do not include text, numbers, chart values, etc.

Prompt Format:
- Image Theme: Image theme representing the core topic of the article
- Visual Context: Specific context or concept the image should express
- Visual Elements: Visual elements that should be included in the image

Absolutely Prohibited:
- Cliché expressions like "moon", "rocket", "to the moon"
- Exaggerated visual elements like price charts, surge arrows
- Text overlays, numbers, chart values
- Generic cryptocurrency imagery (moon, rocket, etc.)`
        : `당신은 블로그 글의 내용을 분석하여 적절한 썸네일 이미지 프롬프트를 생성하는 전문가입니다.
주어진 블로그 글의 제목과 내용을 읽고, 그 내용을 정확히 반영하는 썸네일 이미지를 생성하기 위한 프롬프트를 작성해주세요.

프롬프트 작성 가이드:
1. 블로그 글의 실제 내용과 주제를 정확히 분석하세요
2. 글에서 다루는 핵심 개념, 기술, 주제를 파악하세요
3. 일반적인 암호화폐 이미지가 아닌, 글의 실제 내용에 맞는 구체적인 썸네일을 제안하세요
4. 전문적이고 신뢰할 수 있는 에디토리얼 스타일의 썸네일을 제안하세요
5. 클릭하고 싶게 만드는 강렬하고 매력적인 디자인을 제안하세요
6. 텍스트, 숫자, 차트 값 등은 포함하지 마세요

프롬프트 형식:
- Image Theme: 글의 핵심 주제를 나타내는 이미지 테마
- Visual Context: 이미지가 표현해야 할 구체적인 컨텍스트나 개념
- Visual Elements: 이미지에 포함되어야 할 시각적 요소들

절대 금지:
- "떡상", "급등", "신고가" 같은 클리셰 표현
- 가격 상승 차트, 급등 화살표 등 과장된 시각 요소
- 텍스트 오버레이, 숫자, 차트 값
- 일반적인 암호화폐 이미지 (moon, rocket 등)`;

    const userPrompt =
      lang === 'en'
        ? `Analyze the following blog post content and generate an appropriate thumbnail image prompt:

Title: ${title}
Content: ${contentSummary}

Please create a professional thumbnail image prompt that accurately reflects the content of the article above.`
        : `다음 블로그 글의 내용을 분석하여 적절한 썸네일 이미지 프롬프트를 생성해주세요:

제목: ${title}
내용: ${contentSummary}

위 글의 내용을 정확히 반영하는 전문적인 썸네일 이미지 프롬프트를 작성해주세요.`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-5',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        functions: [
          {
            name: 'generate_thumbnail_prompt',
            description:
              '블로그 글 내용을 분석하여 적절한 썸네일 이미지 생성 프롬프트를 생성합니다.',
            parameters: {
              type: 'object',
              properties: {
                imageTheme: {
                  type: 'string',
                  description:
                    '이미지 테마 (글의 핵심 주제를 나타내는 테마, 예: "digital asset tokenization", "privacy technology", "blockchain infrastructure" 등)',
                },
                visualContext: {
                  type: 'string',
                  description:
                    '시각적 컨텍스트 (이미지가 표현해야 할 구체적인 개념이나 맥락)',
                },
                visualElements: {
                  type: 'string',
                  description:
                    '시각적 요소 (이미지에 포함되어야 할 구체적인 시각적 요소들, 쉼표로 구분)',
                },
              },
              required: ['imageTheme', 'visualContext', 'visualElements'],
            },
          },
        ],
        function_call: { name: 'generate_thumbnail_prompt' },
      });

      const functionCall = response.choices[0]?.message?.function_call;

      if (!functionCall || functionCall.name !== 'generate_thumbnail_prompt') {
        console.warn(
          '[YoutubeDailySummary] AI 썸네일 프롬프트 생성 실패, 기본 프롬프트 사용',
        );
        return this.buildDefaultThumbnailPrompt(title, content);
      }

      const args = JSON.parse(functionCall.arguments || '{}');
      const imageTheme = args.imageTheme || 'blockchain technology';
      const visualContext = args.visualContext || '';
      const visualElements = args.visualElements || '';

      return this.buildFinalThumbnailPrompt(
        title,
        contentSummary,
        imageTheme,
        visualContext,
        visualElements,
      );
    } catch (error) {
      console.error(
        '[YoutubeDailySummary] AI 썸네일 프롬프트 생성 중 오류 발생, 기본 프롬프트 사용:',
        error,
      );
      return this.buildDefaultThumbnailPrompt(title, content);
    }
  }

  /**
   * 기본 썸네일 프롬프트 생성 (AI 분석 실패 시 사용)
   */
  private buildDefaultThumbnailPrompt(title: string, content: string): string {
    const contentSummary = content.substring(0, 500);
    return this.buildFinalThumbnailPrompt(
      title,
      contentSummary,
      'blockchain and cryptocurrency technology',
      'The image should represent modern blockchain technology and digital innovation in finance',
      'modern blockchain technology, digital innovation, financial technology, professional tech setting',
    );
  }

  /**
   * 최종 썸네일 이미지 생성 프롬프트를 생성합니다.
   */
  private buildFinalThumbnailPrompt(
    title: string,
    contentSummary: string,
    imageTheme: string,
    visualContext: string,
    visualElements: string,
  ): string {
    return `Create a professional blog thumbnail image for the following article:

Article Title: ${title}
Content Summary: ${contentSummary}

Based on the article title and content above, determine the most appropriate visual representation.

Image Theme: ${imageTheme}
Visual Context: ${visualContext}
Visual Elements to Include: ${visualElements}

Requirements:
- Professional, editorial-style thumbnail suitable for a financial/technology blog
- Photorealistic style, high resolution (16:9 aspect ratio)
- Clean, modern, and sophisticated design
- Professional business or technology setting that matches the article's actual theme and content
- Use appropriate visual metaphors and symbols that directly relate to what the article discusses
- Balanced composition with strong visual hierarchy
- Professional color palette (blues, grays, whites, with subtle accent colors)
- Serious, informative, and trustworthy atmosphere
- Click-worthy and engaging visual design
- NO text overlays, NO Korean text, NO English text, NO numbers, NO charts with specific values
- NO price indicators, arrows, or market movement symbols
- NO sensational imagery like "moon", "rocket", or exaggerated charts
- NO generic "떡상", "급등", "신고가" imagery
- Focus on representing the concept, technology, or theme professionally
- Editorial photography style (like The Economist, Financial Times, or TechCrunch)
- Avoid cliché cryptocurrency imagery
- Professional and trustworthy appearance suitable for a serious publication
- The image should be directly relevant to the article's content and help illustrate the main points`;
  }

  // 콘텐츠에 이미지 삽입 (섹션 중간에 2개)
  private insertImagesIntoContent(
    content: string,
    imageUrls: string[],
  ): string {
    if (imageUrls.length === 0) {
      return content;
    }

    // 마크다운 헤딩(##)을 기준으로 섹션 분리
    const sections = content.split(/(?=##\s)/);
    if (sections.length < 2) {
      // 섹션이 적으면 첫 번째 이미지만 끝에 추가
      return `${content}\n\n![이미지](${imageUrls[0]})\n\n`;
    }

    // 섹션 중간에 이미지 삽입
    // 첫 번째 이미지: 첫 번째 섹션 이후
    // 두 번째 이미지: 콘텐츠 중간 지점 (섹션 개수의 절반 정도)
    let imageIndex = 0;
    const result: string[] = [];

    // 두 번째 이미지를 삽입할 섹션 인덱스 계산 (중간 지점)
    const middleSectionIndex = Math.floor(sections.length / 2);

    for (let i = 0; i < sections.length; i++) {
      result.push(sections[i]);

      // 첫 번째 이미지: 첫 번째 섹션 이후
      if (i === 0 && imageUrls.length > 0 && imageIndex < imageUrls.length) {
        result.push(`\n\n![이미지](${imageUrls[imageIndex]})\n\n`);
        imageIndex++;
      }
      // 두 번째 이미지: 중간 섹션 이후 (콘텐츠 중간쯤)
      else if (
        i === middleSectionIndex &&
        imageUrls.length > 1 &&
        imageIndex < imageUrls.length
      ) {
        result.push(`\n\n![이미지](${imageUrls[imageIndex]})\n\n`);
        imageIndex++;
      }
    }

    return result.join('');
  }

  // 배치 작업 결과 처리
  private async processBatchJobResults(job: BatchJobCache): Promise<void> {
    try {
      // 배치 결과 다운로드
      const batchJob = await this.openai.batches.retrieve(job.jobId);
      if (!batchJob.output_file_id) {
        throw new Error('배치 작업 결과 파일이 없습니다.');
      }

      const file = await this.openai.files.content(batchJob.output_file_id);
      const content = await file.text();

      // JSON 파싱 (안전하게)
      const results: BatchJobOutput[] = [];
      const lines = content.split('\n').filter((line) => line.trim());

      for (let i = 0; i < lines.length; i++) {
        try {
          const parsed = JSON.parse(lines[i]);
          results.push(parsed);
        } catch (parseError) {
          console.error(
            `[DailySummaryBatch] 배치 결과 JSON 파싱 실패 (라인 ${i + 1}):`,
            parseError,
          );
          console.error(
            `[DailySummaryBatch] 문제가 있는 라인 (첫 500자): ${lines[
              i
            ].substring(0, 500)}`,
          );
          // 파싱 실패한 라인은 건너뛰고 계속 진행
        }
      }

      console.log(
        `[DailySummaryBatch] ${job.jobType} 배치 결과 ${results.length}개 수신`,
      );

      if (job.jobType === 'blog') {
        await this.processBlogResults(job, results);
      } else if (job.jobType === 'translation') {
        await this.processTranslationResults(job, results);
      }

      // 배치 파일 삭제
      if (job.batchFilePath && fs.existsSync(job.batchFilePath)) {
        try {
          fs.unlinkSync(job.batchFilePath);
        } catch (e) {
          // 파일 삭제 실패는 무시
        }
      }

      // 캐시에서 제거
      this.removeBatchJobFromCache(job.jobId);
    } catch (error) {
      console.error(
        `[DailySummaryBatch] 배치 작업 결과 처리 실패. ID: ${job.jobId}`,
        error,
      );
      await GlobalErrorHandler.handleError(
        error as Error,
        'YoutubeDailySummaryService.processBatchJobResults',
        { jobId: job.jobId },
      );
      throw error;
    }
  }

  // 블로그 글 생성 결과 처리
  private async processBlogResults(
    job: BatchJobCache,
    results: BatchJobOutput[],
  ): Promise<void> {
    const blogMap = new Map<
      number,
      { title: string; content: string; thumbnail?: string }
    >();
    const thumbnailRequests: Array<{
      groupIndex: number;
      key: string;
      prompt: string;
      title: string;
      content: string;
    }> = [];
    const imageGenerationFailures: Array<{ topic: string; error?: string }> =
      [];
    const processingFailures: Array<{
      groupIndex: number;
      reason: string;
      error?: string;
    }> = [];

    // 1단계: 블로그 결과 파싱 및 썸네일 생성 준비
    for (const result of results) {
      const groupIndexMatch = result.custom_id.match(/^blog-(.+)$/);
      const groupIndex = groupIndexMatch ? Number(groupIndexMatch[1]) : -1;

      if (result.error) {
        const errorMessage =
          result.error.message || JSON.stringify(result.error);
        console.error(
          `[DailySummaryBatch] 블로그 생성 실패: ${result.custom_id}`,
          result.error,
        );
        processingFailures.push({
          groupIndex,
          reason: '배치 작업 에러',
          error: errorMessage,
        });
        continue;
      }

      const functionCall =
        result.response.body.choices[0]?.message?.function_call;
      if (!functionCall || functionCall.name !== 'generate_daily_blog') {
        const finishReason =
          result.response.body.choices[0]?.finish_reason || 'unknown';
        console.error(
          `[DailySummaryBatch] Function call 실패: ${result.custom_id}, finish_reason: ${finishReason}`,
        );
        if (functionCall) {
          console.error(
            `[DailySummaryBatch] Function call 이름: ${functionCall.name}`,
          );
        }
        processingFailures.push({
          groupIndex,
          reason: 'Function call 실패',
          error: `finish_reason: ${finishReason}`,
        });
        continue;
      }

      // JSON 파싱
      let args: { title?: string; content?: string } = {};
      try {
        const argumentsStr = functionCall.arguments || '{}';
        const cleanedArgs = argumentsStr.trim();
        args = JSON.parse(cleanedArgs);
      } catch (parseError) {
        const parseErrorMessage =
          parseError instanceof Error ? parseError.message : String(parseError);
        console.error(
          `[DailySummaryBatch] JSON 파싱 실패: ${result.custom_id}`,
          parseError,
        );
        console.error(
          `[DailySummaryBatch] Function call arguments (첫 500자): ${functionCall.arguments?.substring(
            0,
            500,
          )}`,
        );
        processingFailures.push({
          groupIndex,
          reason: 'JSON 파싱 실패',
          error: parseErrorMessage,
        });
        continue;
      }

      // content에서 삭선 제거
      if (args.content) {
        args.content = args.content.replace(/~~([^~]+)~~/g, '$1');
      }

      // 참고 링크 섹션 추가 (뉴스가 있는 경우)
      let finalContent = args.content || '';
      const match = result.custom_id.match(/^blog-(.+)$/);
      if (match) {
        const groupIndex = Number(match[1]);
        const group = job.groups.find((g) => g.groupIndex === groupIndex);
        if (group && group.newsResults && group.newsResults.length > 0) {
          const hasReferenceSection =
            finalContent.includes('## 참고') ||
            finalContent.includes('## 참고 링크') ||
            finalContent.includes('참고 링크');

          if (!hasReferenceSection) {
            const referenceLinks = group.newsResults
              .map((news) => `- [${news.title}](${news.link})`)
              .join('\n');
            finalContent += `\n\n## 참고 링크\n\n${referenceLinks}`;
          }
        }

        // topic 변수 정의 (이미지 및 썸네일 생성에 사용)
        const topic = group?.topic || args.title || '암호화폐 투자';

        // 이미지 생성 및 삽입
        let thumbnailUrl: string | null = null;
        try {
          const contentSummary = finalContent.substring(0, 1000);

          console.log(`[YoutubeDailySummary] 이미지 생성 시작: ${topic}`);

          // 이미지 2개 생성
          const imagePromises = [
            this.generateAndUploadImage(topic, contentSummary),
            this.generateAndUploadImage(topic, contentSummary),
          ];

          const imageUrls = (await Promise.all(imagePromises)).filter(
            (url): url is string => url !== null,
          );

          if (imageUrls.length > 0) {
            console.log(
              `[YoutubeDailySummary] ${imageUrls.length}개 이미지 생성 완료`,
            );
            // 첫 번째 이미지를 썸네일로 사용
            thumbnailUrl = imageUrls[0];
            finalContent = this.insertImagesIntoContent(
              finalContent,
              imageUrls,
            );
          } else {
            console.log(
              `[YoutubeDailySummary] 이미지 생성 실패, 이미지 없이 진행`,
            );
            // 이미지 생성 실패 집계 (나중에 한 번에 알림)
            imageGenerationFailures.push({ topic });
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : '알 수 없는 오류';
          console.error(
            `[YoutubeDailySummary] 이미지 생성 중 오류 발생, 이미지 없이 진행:`,
            error,
          );
          // 이미지 생성 오류 집계 (나중에 한 번에 알림)
          imageGenerationFailures.push({ topic, error: errorMessage });
        }

        // 썸네일 생성 준비 (모든 썸네일을 한 번의 배치로 보내기 위해 수집)
        const thumbnailPrompt = await this.buildThumbnailPrompt(
          args.title || topic,
          finalContent,
        );

        // 썸네일 생성 상태 초기화
        if (!job.thumbnailStatus) {
          job.thumbnailStatus = new Map();
        }
        if (!job.thumbnailUrls) {
          job.thumbnailUrls = new Map();
        }
        job.thumbnailStatus.set(groupIndex, 'pending');

        thumbnailRequests.push({
          groupIndex,
          key: `thumbnail-${groupIndex}`,
          prompt: thumbnailPrompt,
          title: args.title || '',
          content: finalContent,
        });

        // 첫 번째 이미지를 썸네일로 저장
        blogMap.set(groupIndex, {
          title: args.title || '',
          content: finalContent,
          thumbnail: thumbnailUrl || undefined,
        });
      }
    }

    // 2단계: 모든 썸네일을 한 번의 배치 작업으로 생성 (비동기, await 없이)
    if (thumbnailRequests.length > 0) {
      try {
        // 썸네일 생성 상태를 pending으로 업데이트
        thumbnailRequests.forEach((req) => {
          if (job.thumbnailStatus) {
            job.thumbnailStatus.set(req.groupIndex, 'pending');
          }
        });

        console.log(
          `[YoutubeDailySummary] ${thumbnailRequests.length}개 썸네일 배치 작업 생성 시작`,
        );

        // 배치 작업 생성 (항상 새로 생성, 주기적으로 체크하여 처리)
        // findOrCreateBatchJob 대신 직접 생성하여 기존 작업 재사용 방지
        const thumbnailBatchJob =
          await this.geminiImageBatchService.createBatchJobOnly(
            thumbnailRequests.map((req) => ({
              key: req.key,
              prompt: req.prompt,
            })),
            `Thumbnails-${job.jobId}-${Date.now()}`,
          );

        // 썸네일 배치 작업 ID 저장
        job.thumbnailJobId = thumbnailBatchJob.name;
        thumbnailRequests.forEach((req) => {
          if (job.thumbnailStatus) {
            job.thumbnailStatus.set(req.groupIndex, 'processing');
          }
        });

        this.updateBatchJobCache(job.jobId, {
          thumbnailJobId: job.thumbnailJobId,
          thumbnailStatus: job.thumbnailStatus,
        });

        console.log(
          `[YoutubeDailySummary] 썸네일 배치 작업 생성 완료: ${job.thumbnailJobId}`,
        );
        console.log(
          `[YoutubeDailySummary] 썸네일 배치 작업은 주기적으로 체크하여 처리됩니다.`,
        );
      } catch (error) {
        console.error(
          `[YoutubeDailySummary] 썸네일 배치 작업 생성 중 오류 발생:`,
          error,
        );
        // 실패한 썸네일 상태 업데이트
        thumbnailRequests.forEach((req) => {
          if (job.thumbnailStatus) {
            job.thumbnailStatus.set(req.groupIndex, 'failed');
          }
        });
        this.updateBatchJobCache(job.jobId, {
          thumbnailStatus: job.thumbnailStatus,
        });
      }
    }

    // 4단계: 한국어 버전 저장
    let savedCount = 0;
    let failedCount = 0;
    for (const [, blog] of blogMap.entries()) {
      try {
        await createBlog({
          title: blog.title,
          content: blog.content,
          author: 'Web3 Scan',
          lang: 'ko',
          thumbnail: blog.thumbnail,
        });

        console.log(
          `[DailySummaryBatch] 한국어 블로그 글 저장 완료: ${blog.title}`,
        );
        savedCount++;
      } catch (error) {
        console.error(
          `[DailySummaryBatch] 한국어 블로그 글 저장 실패: ${blog.title}`,
          error,
        );
        failedCount++;
      }
    }

    // 이미지 생성 실패 알림 (집계하여 한 번만 전송)
    if (imageGenerationFailures.length > 0) {
      try {
        const failureCount = imageGenerationFailures.length;
        const errorCount = imageGenerationFailures.filter(
          (f) => f.error,
        ).length;
        const topics = imageGenerationFailures
          .map((f) => f.topic)
          .slice(0, 5)
          .join(', ');
        const message = `⚠️ **이미지 생성 실패**\n\n**실패 개수:** ${failureCount}개\n**오류 발생:** ${errorCount}개\n**주제 예시:** ${topics}${
          failureCount > 5 ? '...' : ''
        }\n**참고:** 이미지 없이 블로그 글은 계속 진행됩니다.`;
        await sendDiscordMessage(
          message,
          'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
        );
      } catch (discordError) {
        console.error(
          '[Discord] 이미지 생성 실패 알람 전송 실패:',
          discordError,
        );
      }
    }

    // 처리 실패 알림 (JSON 파싱, Function call 실패 등)
    if (processingFailures.length > 0) {
      try {
        const timestamp = new Date().toISOString();
        const failureDetails = processingFailures
          .slice(0, 5)
          .map(
            (f) =>
              `- 그룹 ${f.groupIndex}: ${f.reason}${
                f.error ? ` (${f.error})` : ''
              }`,
          )
          .join('\n');
        const message = `🚨 **블로그 글 생성 처리 실패**\n\n**시간:** ${timestamp}\n**작업 ID:** ${
          job.jobId
        }\n**실패 개수:** ${
          processingFailures.length
        }개\n**상세:**\n${failureDetails}${
          processingFailures.length > 5 ? '\n...' : ''
        }\n**참고:** 배치 작업 결과 파싱 또는 Function call 처리 중 오류가 발생했습니다.`;
        await sendDiscordMessage(
          message,
          'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
        );
      } catch (discordError) {
        console.error('[Discord] 처리 실패 알람 전송 실패:', discordError);
      }
    }

    // 저장 결과 알람
    if (savedCount > 0 || failedCount > 0) {
      await this.sendBlogSaveAlert(job, savedCount, failedCount);
    }

    // 번역 배치 작업 생성 (썸네일이 추가되면 나중에 다시 번역하므로 여기서는 생성하지 않음)
    // 썸네일 배치 작업이 완료되면 processThumbnailBatchResults에서 번역을 생성함
    // 단, 썸네일 요청이 없는 경우에만 여기서 번역 생성
    if (blogMap.size > 0 && thumbnailRequests.length === 0) {
      // 번역이 이미 생성되었는지 확인 (중복 방지)
      // 같은 블로그 작업에서 생성된 번역 작업이 있는지 확인
      const existingTranslationJobs = this.readBatchCache().filter(
        (cachedJob) =>
          cachedJob.jobType === 'translation' &&
          cachedJob.sourceBlogJobId === job.jobId &&
          (cachedJob.status === 'pending' || cachedJob.status === 'processing'),
      );

      if (existingTranslationJobs.length === 0) {
        try {
          const translations = Array.from(blogMap.entries()).map(
            ([groupIndex, blog]) => ({
              groupIndex,
              title: blog.title,
              content: blog.content,
            }),
          );

          console.log(
            `[DailySummaryBatch] ${translations.length}개 번역 배치 작업 생성`,
          );
          const translationBatchFile = await this.createTranslationBatchFile(
            translations,
          );
          const translationJobId = await this.createBatchJob(
            translationBatchFile,
            'translation',
            job.groups,
            blogMap,
          );

          // 번역 작업에 원본 블로그 작업 ID 저장
          this.updateBatchJobCache(translationJobId, {
            sourceBlogJobId: job.jobId,
          });

          console.log(
            `[DailySummaryBatch] 번역 배치 작업 생성 완료: ${translationJobId}`,
          );
        } catch (error) {
          console.error(`[DailySummaryBatch] 번역 배치 작업 생성 실패:`, error);
          await GlobalErrorHandler.handleError(
            error as Error,
            'YoutubeDailySummaryService.processBlogResults',
            { jobId: job.jobId },
          );
        }
      } else {
        console.log(
          `[DailySummaryBatch] 번역 배치 작업이 이미 존재하여 스킵합니다. (기존 작업: ${existingTranslationJobs
            .map((j) => j.jobId)
            .join(', ')})`,
        );
      }
    }
  }

  // 번역 결과 처리
  private async processTranslationResults(
    job: BatchJobCache,
    results: BatchJobOutput[],
  ): Promise<void> {
    const translationMap = new Map<
      number,
      { title: string; content: string; thumbnail?: string }
    >();

    for (const result of results) {
      if (result.error) {
        console.error(
          `[DailySummaryBatch] 번역 실패: ${result.custom_id}`,
          result.error,
        );
        continue;
      }

      const functionCall =
        result.response.body.choices[0]?.message?.function_call;
      if (!functionCall || functionCall.name !== 'translate_blog_to_english') {
        console.error(
          `[DailySummaryBatch] Function call 실패: ${result.custom_id}`,
        );
        continue;
      }

      // JSON 파싱
      let args: { title?: string; content?: string } = {};
      try {
        const argumentsStr = functionCall.arguments || '{}';
        const cleanedArgs = argumentsStr.trim();
        args = JSON.parse(cleanedArgs);
      } catch (parseError) {
        console.error(
          `[DailySummaryBatch] JSON 파싱 실패: ${result.custom_id}`,
          parseError,
        );
        continue;
      }

      // content에서 삭선 제거
      if (args.content) {
        args.content = args.content.replace(/~~([^~]+)~~/g, '$1');
      }

      // custom_id에서 groupIndex 추출: "translation-{groupIndex}"
      const match = result.custom_id.match(/^translation-(.+)$/);
      if (match) {
        const groupIndex = Number(match[1]);
        const group = job.groups.find((g) => g.groupIndex === groupIndex);
        const topic = group?.topic || args.title || 'Cryptocurrency Investment';
        let finalContent = args.content || '';

        // 한국어 버전에서 생성한 썸네일 재사용
        let thumbnailUrl: string | null = null;
        if (job.blogResults) {
          const koreanBlog = job.blogResults.get(groupIndex);
          if (koreanBlog && 'thumbnail' in koreanBlog && koreanBlog.thumbnail) {
            thumbnailUrl = koreanBlog.thumbnail;
            console.log(
              `[YoutubeDailySummary] 한국어 버전 썸네일 재사용: ${groupIndex}`,
            );
          }
        }

        // 썸네일이 없으면 한국어 버전의 썸네일 URL도 확인 (thumbnailUrls에서)
        if (!thumbnailUrl && job.thumbnailUrls) {
          const thumbnailFromMap = job.thumbnailUrls.get(groupIndex);
          if (thumbnailFromMap) {
            thumbnailUrl = thumbnailFromMap;
            console.log(
              `[YoutubeDailySummary] 썸네일 맵에서 재사용: ${groupIndex}`,
            );
          }
        }

        // 한국어 버전의 이미지도 재사용 (본문에 삽입된 이미지)
        // 한국어 버전의 content에서 이미지 URL 추출
        if (job.blogResults) {
          const koreanBlog = job.blogResults.get(groupIndex);
          if (koreanBlog && koreanBlog.content) {
            // 마크다운 이미지 패턴: ![alt](url)
            const imageRegex = /!\[[^\]]*\]\(([^)]+)\)/g;
            const koreanImages: string[] = [];
            let match;
            while ((match = imageRegex.exec(koreanBlog.content)) !== null) {
              koreanImages.push(match[1]);
            }

            // 한국어 버전의 이미지를 영어 버전에도 삽입
            if (koreanImages.length > 0) {
              console.log(
                `[YoutubeDailySummary] 한국어 버전 이미지 ${koreanImages.length}개 재사용: ${groupIndex}`,
              );
              finalContent = this.insertImagesIntoContent(
                finalContent,
                koreanImages,
              );
            }
          }
        }

        translationMap.set(groupIndex, {
          title: args.title || '',
          content: finalContent,
          thumbnail: thumbnailUrl || undefined,
        });
      }
    }

    // 영어 버전 저장
    let savedCount = 0;
    let failedCount = 0;
    for (const [, translation] of translationMap.entries()) {
      try {
        await createBlog({
          title: translation.title,
          content: translation.content,
          author: 'Web3 Scan',
          lang: 'en',
          thumbnail: translation.thumbnail,
        });

        console.log(
          `[DailySummaryBatch] 영어 블로그 글 저장 완료: ${translation.title}`,
        );
        savedCount++;
      } catch (error) {
        console.error(
          `[DailySummaryBatch] 영어 블로그 글 저장 실패: ${translation.title}`,
          error,
        );
        failedCount++;
      }
    }

    // 저장 결과 알람
    if (savedCount > 0 || failedCount > 0) {
      await this.sendTranslationSaveAlert(job, savedCount, failedCount);
    }
  }

  // 블로그 글 저장 결과 알람
  private async sendBlogSaveAlert(
    job: BatchJobCache,
    savedCount: number,
    failedCount: number,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      let message = `📝 **데일리 서머리 블로그 글 저장 완료**\n\n`;
      message += `**시간:** ${timestamp}\n`;
      message += `**작업 ID:** ${job.jobId}\n`;
      message += `**성공:** ${savedCount}개\n`;
      if (failedCount > 0) {
        message += `**실패:** ${failedCount}개 ⚠️\n`;
      }

      await sendDiscordMessage(
        message,
        'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
      );
    } catch (error) {
      console.error('[Discord] 블로그 저장 알람 전송 실패:', error);
    }
  }

  // 번역 저장 결과 알람
  private async sendTranslationSaveAlert(
    job: BatchJobCache,
    savedCount: number,
    failedCount: number,
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      let message = `🌐 **데일리 서머리 번역 저장 완료**\n\n`;
      message += `**시간:** ${timestamp}\n`;
      message += `**작업 ID:** ${job.jobId}\n`;
      message += `**성공:** ${savedCount}개\n`;
      if (failedCount > 0) {
        message += `**실패:** ${failedCount}개 ⚠️\n`;
      }

      await sendDiscordMessage(
        message,
        'https://discord.com/api/webhooks/1442706911119151276/qVB4crG3fHSgtPUxehMT9QkxyXzqsx47p7FCT0lhZHL6Mgj-G2LYb86PjQl_RHN0HYoO',
      );
    } catch (error) {
      console.error('[Discord] 번역 저장 알람 전송 실패:', error);
    }
  }
}
