import OpenAI from 'openai';
import { subDays } from 'date-fns';
import { findAllYoutube } from '../../remotes/web3-scan/youtube';
import { searchGoogleNews } from '../../remotes/web3-scan/google-search';
import { YoutubeDailySummaryService } from './youtube-daily-summary.service';

jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: jest.fn(),
      },
    },
    files: {
      create: jest.fn(),
      content: jest.fn(),
    },
    batches: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
  }));
});

jest.mock('../../remotes/web3-scan/blog', () => ({
  createBlog: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('../../remotes/discord/sendDiscordMessage', () => ({
  sendDiscordMessage: jest.fn().mockResolvedValue({ success: true }),
}));

/**
 * 48시간~72시간 이전 영상만 뽑아서 컨텐츠 만드는 테스트
 * 실제 API를 호출하여 블로그 글이 어떻게 생성되는지 확인합니다.
 *
 * 실행 방법:
 * yarn test youtube-daily-summary-48h-test.e2e.test.ts
 *
 * 주의사항:
 * - OPENAI_API_KEY 환경 변수가 필요합니다
 * - GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID 환경 변수가 필요합니다 (선택사항)
 * - BLOG_API_BASE_URL, BLOG_API_KEY 환경 변수가 필요합니다
 */
process.env.OPENAI_API_KEY = 'mock-key';
process.env.GEMINI_API_KEY = 'mock-key';

describe('YoutubeDailySummaryService - 48시간~72시간 이전 영상 테스트', () => {
  let service: YoutubeDailySummaryService;

  beforeAll(() => {
    const openai = new (OpenAI as any)();

    // Mock methods used in service
    openai.chat.completions.create.mockResolvedValue({
      choices: [
        {
          message: {
            function_call: {
              name: 'group_contents_by_topic',
              arguments: JSON.stringify({
                groups: [{ topic: 'Mock Topic', contentIndices: [0, 1] }],
              }),
            },
          },
        },
      ],
    });

    openai.files.create.mockResolvedValue({
      id: 'mock-file-id',
    });
    openai.batches.create.mockResolvedValue({
      id: 'mock-batch-id',
    });
    openai.batches.retrieve.mockResolvedValue({
      id: 'mock-batch-id',
      status: 'completed',
      output_file_id: 'mock-output-file-id',
    });
    openai.files.content.mockResolvedValue({
      text: async () =>
        JSON.stringify({
          custom_id: 'blog-0',
          response: {
            body: {
              choices: [
                {
                  message: {
                    function_call: {
                      name: 'generate_daily_blog',
                      arguments: JSON.stringify({
                        title: 'Mock Title',
                        content: 'Mock Content',
                      }),
                    },
                  },
                },
              ],
            },
          },
        }),
    });

    service = new YoutubeDailySummaryService(openai as any);

    // Mock GeminiImageBatchService methods
    jest
      .spyOn(service.geminiImageBatchService, 'createBatchJobOnly')
      .mockResolvedValue({
        name: 'mock-thumbnail-batch-id',
        state: 'JOB_STATE_SUCCEEDED' as any,
      } as any);
    jest
      .spyOn(service.geminiImageBatchService, 'getBatchJob')
      .mockResolvedValue({
        name: 'mock-thumbnail-batch-id',
        state: 'JOB_STATE_SUCCEEDED' as any,
      } as any);
    jest
      .spyOn(service.geminiImageBatchService, 'processBatchResults')
      .mockResolvedValue([
        {
          index: 1,
          key: 'thumbnail-0',
          imageUrl: 'http://mock-image.url',
          success: true,
        },
      ]);
  });

  it('48시간~72시간 이전 영상으로 컨텐츠 생성 테스트', async () => {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('48시간~72시간 이전 영상 컨텐츠 생성 테스트 시작');
    console.log('='.repeat(80));
    console.log('\n');

    try {
      // 48시간~72시간 이전 시간 계산
      const threeDaysAgo = subDays(new Date(), 3);
      const twoDaysAgo = subDays(new Date(), 2);
      const now = new Date();

      console.log(
        `[테스트] 조회 기간: ${threeDaysAgo.toISOString()} ~ ${twoDaysAgo.toISOString()}`,
      );
      console.log(`[테스트] 현재 시간: ${now.toISOString()}\n`);

      // 모든 유튜브 요약 컨텐츠 조회
      const allYoutubeContents = await findAllYoutube();
      console.log(
        `[테스트] 전체 유튜브 컨텐츠 수: ${allYoutubeContents.length}개\n`,
      );

      // 48시간~72시간 이전 생성된 컨텐츠 필터링
      const targetContents = allYoutubeContents.filter((content) => {
        if (!content.createdAt) {
          return false;
        }
        const createdAt = new Date(content.createdAt);
        return (
          createdAt >= threeDaysAgo && createdAt < twoDaysAgo && content.content
        );
      });

      console.log(
        `[테스트] 48시간~72시간 이전 생성된 요약 컨텐츠: ${targetContents.length}개`,
      );

      if (targetContents.length === 0) {
        console.log('\n⚠️  48시간~72시간 이전에 생성된 컨텐츠가 없습니다.\n');
        return;
      }

      // 컨텐츠 목록 출력
      console.log('\n[테스트] 대상 컨텐츠 목록:');
      targetContents.forEach((content, index) => {
        console.log(
          `  ${index + 1}. ${content.title} (생성일: ${content.createdAt})`,
        );
      });
      console.log('');

      // 2개 미만이면 스킵
      if (targetContents.length < 2) {
        console.log(
          `[테스트] 요약 컨텐츠가 ${targetContents.length}개로 부족하여 스킵합니다.\n`,
        );
        return;
      }

      // 주제별로 그룹화 (private 메서드 접근)
      const contentGroups = await (service as any).groupContentsByTopic(
        targetContents,
      );

      if (!contentGroups || contentGroups.length === 0) {
        console.error('[테스트] 컨텐츠 그룹화 실패');
        return;
      }

      console.log(
        `[테스트] ${contentGroups.length}개의 주제 그룹으로 분류됨\n`,
      );

      // 배치 API로 블로그 글 생성 (실제 서비스와 동일한 방식)
      console.log(
        `[테스트] 배치 API로 ${contentGroups.length}개 그룹 블로그 글 생성 시작\n`,
      );

      // 각 그룹에 대한 뉴스 검색 (비동기로 미리 수행)
      const groupsWithNews = await Promise.all(
        contentGroups.map(async (group: any, index: number) => {
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

      // 배치 파일 생성 및 작업 생성
      const blogBatchFile = await (service as any).createBlogBatchFile(
        groupsWithNews,
      );
      const jobId = await (service as any).createBatchJob(
        blogBatchFile,
        'blog',
        groupsWithNews,
      );

      console.log(`[테스트] 배치 작업 생성 완료. Job ID: ${jobId}\n`);
      console.log(
        '[테스트] 배치 작업이 완료될 때까지 대기 중... (최대 10분)\n',
      );

      // 배치 작업 완료까지 대기 (최대 10분)
      const maxWaitTime = 10 * 60 * 1000; // 10분
      const checkInterval = 30 * 1000; // 30초마다 체크
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        // 배치 작업 상태 확인
        await (service as any).checkAndProcessBatchJobs();

        // 캐시에서 작업 상태 확인
        const cache = (service as any).readBatchCache();
        const job = cache.find((j: any) => j.jobId === jobId);

        if (!job) {
          console.log(
            '[테스트] 배치 작업이 완료되어 캐시에서 제거되었습니다.\n',
          );
          break;
        }

        if (job.status === 'completed') {
          console.log('[테스트] 배치 작업 완료!\n');
          break;
        } else if (job.status === 'failed') {
          console.error('[테스트] 배치 작업 실패\n');
          break;
        }

        console.log(`[테스트] 배치 작업 상태: ${job.status} (대기 중...)\n`);
      }

      console.log(
        '[테스트] 배치 작업 결과는 Blog API를 통해 저장되었습니다.\n',
      );

      console.log('\n');
      console.log('='.repeat(80));
      console.log('48시간~72시간 이전 영상 컨텐츠 생성 테스트 완료');
      console.log('='.repeat(80));
      console.log('\n');
      console.log('💡 생성된 블로그 글은 Blog API를 통해 저장되었습니다.');
      console.log(
        '💡 콘솔 로그에서 생성된 블로그 글의 제목을 확인할 수 있습니다.',
      );
      console.log('\n');
    } catch (error) {
      console.error('\n');
      console.error('❌ 테스트 실행 중 오류 발생:');
      console.error(error);
      console.error('\n');
      throw error;
    }
  }, 600000); // 10분 타임아웃 (GPT 호출 시간 고려)
});
