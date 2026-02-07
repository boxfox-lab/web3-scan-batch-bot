import OpenAI from 'openai';
import { findAllYoutube } from '../../remotes/web3-scan/youtube';
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
 * 배치 작업 플로우 테스트
 *
 * 플로우:
 * 1. 첫 번째 실행: 배치 작업 생성 (블로그 글 생성 요청)
 * 2. 두 번째 실행: 배치 작업 결과 확인 및 저장
 *
 * 실행 방법:
 * yarn test youtube-daily-summary.service.e2e.test.ts
 *
 * 주의사항:
 * - OPENAI_API_KEY 환경 변수가 필요합니다
 * - GOOGLE_SEARCH_API_KEY, GOOGLE_SEARCH_ENGINE_ID 환경 변수가 필요합니다 (선택사항)
 * - BLOG_API_BASE_URL, BLOG_API_KEY 환경 변수가 필요합니다
 */
process.env.OPENAI_API_KEY = 'mock-key';
process.env.GEMINI_API_KEY = 'mock-key';

describe('YoutubeDailySummaryService - 배치 작업 플로우 테스트', () => {
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

  it('1단계: 배치 작업 생성 (블로그 글 생성 요청)', async () => {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('1단계: 배치 작업 생성 테스트 시작');
    console.log('='.repeat(80));
    console.log('\n');

    try {
      // 24시간 내 컨텐츠 확인
      const allContents = await findAllYoutube();
      console.log(`[1단계] 전체 유튜브 컨텐츠 수: ${allContents.length}개\n`);

      // 실제 프로세스 실행 (배치 작업 생성)
      await service.process();

      // 캐시에서 생성된 배치 작업 확인
      const cache = (service as any).readBatchCache();
      const pendingJobs = cache.filter(
        (job: any) => job.status === 'pending' || job.status === 'processing',
      );

      console.log('\n');
      console.log('='.repeat(80));
      console.log('1단계: 배치 작업 생성 테스트 완료');
      console.log('='.repeat(80));
      console.log(`\n[1단계] 생성된 배치 작업 수: ${pendingJobs.length}개\n`);

      if (pendingJobs.length > 0) {
        pendingJobs.forEach((job: any, index: number) => {
          console.log(
            `  ${index + 1}. 작업 ID: ${job.jobId} (${job.jobType}, 상태: ${
              job.status
            })`,
          );
        });
        console.log('\n');
        console.log(
          '💡 다음 단계로 진행하려면 배치 작업이 완료될 때까지 기다린 후',
        );
        console.log(
          '   "2단계: 배치 작업 결과 확인 및 저장" 테스트를 실행하세요.',
        );
        console.log(
          '   또는 checkAndProcessBatchJobs()를 주기적으로 호출하세요.\n',
        );
      } else {
        console.log('⚠️  생성된 배치 작업이 없습니다.\n');
        console.log('   - 24시간 내 생성된 컨텐츠가 2개 미만일 수 있습니다.');
        console.log('   - 또는 이미 모든 작업이 완료되었을 수 있습니다.\n');
      }
    } catch (error) {
      console.error('\n');
      console.error('❌ 1단계 테스트 실행 중 오류 발생:');
      console.error(error);
      console.error('\n');
      throw error;
    }
  }, 300000); // 5분 타임아웃

  it('2단계: 배치 작업 결과 확인 및 저장', async () => {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('2단계: 배치 작업 결과 확인 및 저장 테스트 시작');
    console.log('='.repeat(80));
    console.log('\n');

    try {
      // 캐시에서 대기 중인 배치 작업 확인
      const cache = (service as any).readBatchCache();
      const pendingJobs = cache.filter(
        (job: any) => job.status === 'pending' || job.status === 'processing',
      );

      console.log(`[2단계] 대기 중인 배치 작업 수: ${pendingJobs.length}개\n`);

      if (pendingJobs.length === 0) {
        console.log('⚠️  대기 중인 배치 작업이 없습니다.\n');
        console.log('   - 모든 작업이 완료되었거나');
        console.log('   - 먼저 "1단계: 배치 작업 생성" 테스트를 실행하세요.\n');
        return;
      }

      // 각 작업 상태 출력
      pendingJobs.forEach((job: any, index: number) => {
        console.log(
          `  ${index + 1}. 작업 ID: ${job.jobId} (${job.jobType}, 상태: ${
            job.status
          })`,
        );
      });
      console.log('\n');

      // 배치 작업 상태 확인 및 처리
      console.log('[2단계] 배치 작업 상태 확인 및 처리 중...\n');
      await service.checkAndProcessBatchJobs();

      // 처리 후 상태 확인
      const cacheAfter = (service as any).readBatchCache();
      const remainingJobs = cacheAfter.filter(
        (job: any) => job.status === 'pending' || job.status === 'processing',
      );

      console.log('\n');
      console.log('='.repeat(80));
      console.log('2단계: 배치 작업 결과 확인 및 저장 테스트 완료');
      console.log('='.repeat(80));
      console.log(
        `\n[2단계] 처리 후 남은 작업 수: ${remainingJobs.length}개\n`,
      );

      if (remainingJobs.length === 0) {
        console.log('✅ 모든 배치 작업이 완료되었습니다!\n');
        console.log('💡 생성된 블로그 글은 Blog API를 통해 저장되었습니다.');
        console.log(
          '💡 콘솔 로그에서 생성된 블로그 글의 제목을 확인할 수 있습니다.\n',
        );
      } else {
        console.log('⏳ 일부 작업이 아직 진행 중입니다.\n');
        console.log('   - 배치 작업이 완료될 때까지 기다린 후');
        console.log('   - 이 테스트를 다시 실행하세요.\n');
      }
    } catch (error) {
      console.error('\n');
      console.error('❌ 2단계 테스트 실행 중 오류 발생:');
      console.error(error);
      console.error('\n');
      throw error;
    }
  }, 300000); // 5분 타임아웃

  it('전체 플로우: 배치 작업 생성부터 완료까지', async () => {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('전체 플로우 테스트 시작');
    console.log('='.repeat(80));
    console.log('\n');

    try {
      // 1단계: 배치 작업 생성
      console.log('[전체 플로우] 1단계: 배치 작업 생성 중...\n');
      await service.process();

      // 캐시에서 생성된 배치 작업 확인
      const cache = (service as any).readBatchCache();
      const pendingJobs = cache.filter(
        (job: any) => job.status === 'pending' || job.status === 'processing',
      );

      if (pendingJobs.length === 0) {
        console.log('⚠️  생성된 배치 작업이 없습니다. 테스트를 종료합니다.\n');
        return;
      }

      console.log(`[전체 플로우] 생성된 배치 작업: ${pendingJobs.length}개\n`);

      // 2단계: 배치 작업 완료까지 대기 및 처리
      console.log(
        '[전체 플로우] 2단계: 배치 작업 완료까지 대기 중... (최대 10분)\n',
      );

      const maxWaitTime = 10 * 60 * 1000; // 10분
      const checkInterval = 30 * 1000; // 30초마다 체크
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        await new Promise((resolve) => setTimeout(resolve, checkInterval));

        // 배치 작업 상태 확인 및 처리
        await service.checkAndProcessBatchJobs();

        // 캐시에서 작업 상태 확인
        const currentCache = (service as any).readBatchCache();
        const remainingJobs = currentCache.filter(
          (job: any) => job.status === 'pending' || job.status === 'processing',
        );

        if (remainingJobs.length === 0) {
          console.log('\n[전체 플로우] 모든 배치 작업이 완료되었습니다!\n');
          break;
        }

        const elapsedMinutes = Math.floor((Date.now() - startTime) / 1000 / 60);
        console.log(
          `[전체 플로우] 대기 중... (경과: ${elapsedMinutes}분, 남은 작업: ${remainingJobs.length}개)`,
        );
      }

      const finalCache = (service as any).readBatchCache();
      const finalRemainingJobs = finalCache.filter(
        (job: any) => job.status === 'pending' || job.status === 'processing',
      );

      console.log('\n');
      console.log('='.repeat(80));
      console.log('전체 플로우 테스트 완료');
      console.log('='.repeat(80));
      console.log(
        `\n[전체 플로우] 최종 남은 작업 수: ${finalRemainingJobs.length}개\n`,
      );

      if (finalRemainingJobs.length === 0) {
        console.log('✅ 모든 배치 작업이 완료되었습니다!\n');
        console.log('💡 생성된 블로그 글은 Blog API를 통해 저장되었습니다.');
        console.log(
          '💡 콘솔 로그에서 생성된 블로그 글의 제목을 확인할 수 있습니다.\n',
        );
      } else {
        console.log('⏳ 일부 작업이 아직 진행 중입니다.\n');
        console.log('   - 배치 작업이 완료될 때까지 기다리거나');
        console.log(
          '   - "2단계: 배치 작업 결과 확인 및 저장" 테스트를 다시 실행하세요.\n',
        );
      }
    } catch (error) {
      console.error('\n');
      console.error('❌ 전체 플로우 테스트 실행 중 오류 발생:');
      console.error(error);
      console.error('\n');
      throw error;
    }
  }, 600000); // 10분 타임아웃
});
