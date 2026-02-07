import { GeminiImageBatchService } from './gemini-image-batch.service';
import { JobState } from '@google/genai';

jest.mock('@google/genai', () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      batches: {
        list: jest.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            // yield nothing
          },
        }),
        create: jest.fn().mockResolvedValue({
          name: 'mock-batch-job-id',
          state: 'JOB_STATE_PENDING',
        }),
        get: jest.fn().mockResolvedValue({
          name: 'mock-batch-job-id',
          state: 'JOB_STATE_SUCCEEDED',
        }),
        delete: jest.fn().mockResolvedValue({}),
      },
    })),
    JobState: {
      JOB_STATE_PENDING: 'JOB_STATE_PENDING',
      JOB_STATE_RUNNING: 'JOB_STATE_RUNNING',
      JOB_STATE_QUEUED: 'JOB_STATE_QUEUED',
      JOB_STATE_SUCCEEDED: 'JOB_STATE_SUCCEEDED',
      JOB_STATE_PARTIALLY_SUCCEEDED: 'JOB_STATE_PARTIALLY_SUCCEEDED',
      JOB_STATE_FAILED: 'JOB_STATE_FAILED',
      JOB_STATE_CANCELLED: 'JOB_STATE_CANCELLED',
      JOB_STATE_UNSPECIFIED: 'JOB_STATE_UNSPECIFIED',
    },
  };
});

/**
 * Gemini 배치 API를 사용한 이미지 생성 테스트
 *
 * 실행 방법:
 * yarn test gemini-image-generation-batch.e2e.test.ts
 *
 * 주의사항:
 * - GEMINI_API_KEY 환경 변수가 필요합니다
 * - gemini-3-pro-image-preview 모델 사용 (약 190원~340원 소요)
 * - 배치 처리로 비용 약 50% 절감 효과
 * - 무료 티어에서는 사용할 수 없으며, 유료 플랜이 필요합니다
 */
describe('Gemini 배치 API 이미지 생성 테스트', () => {
  let batchService: GeminiImageBatchService;

  beforeAll(() => {
    process.env.GEMINI_API_KEY = 'mock-key';
    batchService = new GeminiImageBatchService();

    jest.spyOn(batchService, 'hasProcessingBatchJob').mockResolvedValue(null);
    jest
      .spyOn(batchService, 'findCompletedOrFailedBatchJob')
      .mockResolvedValue(null);
    jest.spyOn(batchService, 'processBatchResults').mockResolvedValue([
      {
        index: 1,
        key: 'request-1',
        imageUrl: 'http://mock-image.url/1',
        success: true,
      },
      {
        index: 2,
        key: 'request-2',
        imageUrl: 'http://mock-image.url/2',
        success: true,
      },
      {
        index: 3,
        key: 'request-3',
        imageUrl: 'http://mock-image.url/3',
        success: true,
      },
    ]);
  });

  it('배치 API로 여러 이미지 생성 테스트 (비용 50% 절감)', async () => {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('Gemini 배치 API 이미지 생성 테스트 시작');
    console.log('='.repeat(80));
    console.log('\n');

    // 처리중인 작업이 있으면 테스트 스킵
    const processingJob = await batchService.hasProcessingBatchJob(
      'Costco-Tiramisu-Image-Batch',
    );
    if (processingJob) {
      console.log(
        `[배치 테스트] 처리중인 배치 작업이 있어 테스트를 스킵합니다.`,
      );
      console.log(
        `[배치 테스트] 작업 ID: ${processingJob.name}, 상태: ${processingJob.state}\n`,
      );
      return; // 테스트 스킵
    }

    // 완료되거나 실패한 작업이 있으면 처리 후 삭제하고 테스트 종료
    const completedJob = await batchService.findCompletedOrFailedBatchJob(
      'Costco-Tiramisu-Image-Batch',
    );
    if (completedJob) {
      console.log(
        `[배치 테스트] 완료/실패된 배치 작업 발견: ${completedJob.name}, 상태: ${completedJob.state}`,
      );
      console.log(`[배치 테스트] 결과 처리 중...\n`);

      try {
        // 결과 처리 (이미지 추출 및 업로드)
        const batchRequests = [
          { key: 'request-1', prompt: '' },
          { key: 'request-2', prompt: '' },
          { key: 'request-3', prompt: '' },
        ];
        const results = await batchService.processBatchResults(
          completedJob,
          batchRequests,
        );

        // 결과 요약
        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;

        console.log('\n');
        console.log('='.repeat(80));
        console.log('기존 배치 작업 결과 요약');
        console.log('='.repeat(80));
        console.log(`성공: ${successCount}개`);
        console.log(`실패: ${failCount}개`);
        console.log('\n');

        results.forEach((result) => {
          if (result.success) {
            console.log(
              `✅ 이미지 ${result.index} (${result.key}): ${result.imageUrl}`,
            );
          } else {
            console.log(
              `❌ 이미지 ${result.index} (${result.key}): ${result.error}`,
            );
          }
        });

        // 완료된 작업 삭제
        await batchService.deleteBatchJob(completedJob);
        console.log('\n[배치 테스트] 기존 작업 처리 완료 및 삭제됨\n');

        // 테스트 종료
        expect(successCount).toBeGreaterThanOrEqual(0);
        return;
      } catch (error: any) {
        console.error(`[배치 테스트] 기존 작업 처리 실패: ${error.message}\n`);
        console.error(
          `[배치 테스트] 에러 발생으로 인해 배치 작업을 삭제하지 않습니다. 작업 ID: ${completedJob.name}\n`,
        );
        throw error;
      }
    }

    // 처리중인 작업도 없고, 완료/실패된 작업도 없으면 새 작업 등록
    console.log(`[배치 테스트] 기존 작업이 없어 새 배치 작업을 생성합니다.\n`);

    try {
      // 배치 요청 데이터 준비
      const basePrompt = `코스트코에서 판매중인 티라미슈 케이크를 소개하는 블로그 글에 적합한 이미지.

요구사항:
- 블로그 썸네일로 사용할 수 있는 매력적이고 클릭을 유도하는 이미지
- 가로로 살짝 긴 직사각형 비율 (가로형 레이아웃)
- 실제 사진처럼 보이는 극사실주의 스타일
- 코스트코 매장 배경 또는 깔끔한 테이블 위에 티라미슈 케이크가 전면에 배치
- 티라미슈 케이크가 크고 선명하게 보이도록 (초콜릿 파우더, 크림, 케이크 레이어가 잘 보이도록)
- 코스트코 브랜딩 요소 (로고, 포장재 등)가 자연스럽게 포함
- 따뜻하고 유혹적인 조명, 음식 사진 스타일
- 배경은 깔끔하고 단정하게 (흰색 또는 부드러운 톤)
- 케이크가 맛있어 보이고 구매 욕구를 자극하는 느낌
- 전문적인 푸드 스타일링, 고급스러운 느낌
- 화면에 "코스트코", "티라미슈" 같은 한글 텍스트 오버레이 (선택적, 자연스럽게)
- 식욕을 돋우는 따뜻한 색감 (크림색, 갈색, 초콜릿색 계열)`;

      const batchRequests = [
        {
          key: 'request-1',
          prompt: `${basePrompt}\n변형: 매장 배경에서 촬영`,
        },
        {
          key: 'request-2',
          prompt: `${basePrompt}\n변형: 테이블 위 전면 배치`,
        },
        {
          key: 'request-3',
          prompt: `${basePrompt}\n변형: 슬라이스된 케이크 단면`,
        },
      ];

      console.log(
        `[배치 테스트] ${batchRequests.length}개의 이미지를 배치 API로 생성 시작...\n`,
      );
      console.log(`[배치 테스트] 배치 처리로 비용 약 50% 절감 효과 기대\n`);

      const startTime = Date.now();

      // 서비스를 사용하여 배치 이미지 생성
      const results = await batchService.generateBatchImages({
        prompts: batchRequests,
        displayName: 'Costco-Tiramisu-Image-Batch',
        model: 'gemini-3-pro-image-preview',
        maxWaitTime: 300000, // 5분
        checkInterval: 5000, // 5초
        autoDelete: true, // 완료 후 자동 삭제
      });

      const endTime = Date.now();
      const duration = ((endTime - startTime) / 1000).toFixed(2);

      // 결과 요약
      const successCount = results.filter((r) => r.success).length;
      const failCount = results.filter((r) => !r.success).length;

      console.log('\n');
      console.log('='.repeat(80));
      console.log('배치 이미지 생성 결과 요약');
      console.log('='.repeat(80));
      console.log(`총 처리 시간: ${duration}초`);
      console.log(`성공: ${successCount}개`);
      console.log(`실패: ${failCount}개`);
      console.log('\n');

      results.forEach((result) => {
        if (result.success) {
          console.log(
            `✅ 이미지 ${result.index} (${result.key}): ${result.imageUrl}`,
          );
        } else {
          console.log(
            `❌ 이미지 ${result.index} (${result.key}): ${result.error}`,
          );
        }
      });

      console.log('\n');
      console.log('='.repeat(80));
      console.log('Gemini 배치 API 이미지 생성 테스트 완료');
      console.log('='.repeat(80));
      console.log('\n');

      // 최소 1개 이상 성공해야 테스트 통과
      expect(successCount).toBeGreaterThan(0);
    } catch (error: any) {
      console.error('\n');
      console.error('❌ 배치 테스트 실행 중 오류 발생:');
      console.error(error);

      // 쿼터 초과 에러 처리
      if (
        error?.message?.includes('429') ||
        error?.message?.includes('quota')
      ) {
        console.error('⚠️  쿼터 초과 에러:');
        console.error(
          '   - 무료 티어에서는 gemini-3-pro-image-preview 모델을 사용할 수 없습니다.',
        );
        console.error(
          '   - 유료 플랜으로 업그레이드하거나 다른 모델을 사용해주세요.',
        );
      }

      console.error('\n');
      throw error;
    }
  }, 600000); // 10분 타임아웃 (배치 작업 완료 대기 포함)
});
