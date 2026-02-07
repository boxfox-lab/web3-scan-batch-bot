import { GoogleGenerativeAI } from '@google/generative-ai';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { uploadImage } from '../../remotes/image';

jest.mock('@google/generative-ai');
const MockedGoogleGenerativeAI = GoogleGenerativeAI as jest.MockedClass<
  typeof GoogleGenerativeAI
>;

jest.mock('../../remotes/image', () => ({
  uploadImage: jest.fn().mockResolvedValue('http://mock-uploaded-image.url'),
}));

/**
 * Gemini를 사용한 이미지 생성 테스트
 *
 * 실행 방법:
 * yarn test gemini-image-generation.e2e.test.ts
 *
 * 주의사항:
 * - GEMINI_API_KEY 환경 변수가 필요합니다
 * - gemini-3-pro-image-preview 모델 사용 (약 190원~340원 소요)
 * - 무료 티어에서는 사용할 수 없으며, 유료 플랜이 필요합니다
 */
describe('Gemini 이미지 생성 테스트', () => {
  let genAI: GoogleGenerativeAI;

  beforeAll(() => {
    genAI = new MockedGoogleGenerativeAI('mock-key');

    (genAI.getGenerativeModel as jest.Mock).mockReturnValue({
      generateContent: jest.mocked(async () => ({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: 'mock-base64-data',
                      mimeType: 'image/png',
                    },
                  },
                ],
              },
            },
          ],
        },
      })),
    });
  });

  it('Gemini로 직접 이미지 생성 테스트', async () => {
    console.log('\n');
    console.log('='.repeat(80));
    console.log('Gemini 이미지 생성 테스트 시작');
    console.log('='.repeat(80));
    console.log('\n');

    try {
      const topic = '코스트코 티라미슈 케이크';
      const contentSummary =
        '코스트코에서 판매중인 티라미슈 케이크를 소개하는 블로그 글입니다. 가격, 맛, 구매 후기 등을 다룹니다.';

      console.log(`[테스트] 주제: ${topic}`);
      console.log(
        `[테스트] 내용 요약: ${contentSummary.substring(0, 100)}...\n`,
      );

      // Gemini Pro 모델로 이미지 생성 (한글 텍스트 오버레이를 위해 pro 사용)
      console.log(
        '[테스트] Gemini Pro로 이미지 생성 중... (약 190원~340원 소요)\n',
      );

      const model = genAI.getGenerativeModel({
        model: 'gemini-3-pro-image-preview',
      });

      const prompt = `코스트코에서 판매중인 티라미슈 케이크를 소개하는 블로그 글에 적합한 이미지.

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

      const result = await model.generateContent(prompt);

      // 응답 JSON 파일로 저장
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jsonFileName = `gemini-response-${timestamp}.json`;
      const jsonFilePath = join(process.cwd(), jsonFileName);
      await writeFile(
        jsonFilePath,
        JSON.stringify(result.response, null, 2),
        'utf-8',
      );
      console.log(`[테스트] 응답 JSON 저장 완료: ${jsonFilePath}\n`);

      const parts = result.response.candidates?.[0]?.content?.parts || [];
      console.log(`[테스트] parts 개수: ${parts.length}`);
      parts.forEach((part: any, index: number) => {
        console.log(`[테스트] parts[${index}] 키:`, Object.keys(part));
      });

      // 이미지 데이터 추출 (Base64 형태) - parts 배열에서 inlineData 찾기
      let artifacts = null;
      for (const part of parts) {
        if (part.inlineData) {
          artifacts = part.inlineData;
          break;
        }
      }

      if (!artifacts || !artifacts.data) {
        throw new Error('이미지 데이터를 찾을 수 없습니다.');
      }

      console.log('[테스트] 이미지 데이터 추출 완료\n');

      // Base64 데이터 추출
      const base64Data = artifacts.data;

      // 이미지 업로드
      console.log('[테스트] 이미지 업로드 중...\n');

      console.log(base64Data);
      const imageUrl = await uploadImage(base64Data);

      console.log(`[테스트] 이미지 생성 완료!`);
      console.log(`[테스트] 이미지 URL: ${imageUrl}\n`);

      expect(imageUrl).toBeDefined();
      expect(imageUrl).toContain('http');

      console.log('='.repeat(80));
      console.log('Gemini 이미지 생성 테스트 완료');
      console.log('='.repeat(80));
      console.log('\n');
    } catch (error: any) {
      console.error('\n');
      console.error('❌ 테스트 실행 중 오류 발생:');

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
        console.error(
          '   - 자세한 정보: https://ai.google.dev/gemini-api/docs/rate-limits',
        );

        if (error?.message?.includes('retryDelay')) {
          const retryMatch = error.message.match(/retryDelay["']:\s*"(\d+)s/);
          if (retryMatch) {
            const retrySeconds = parseInt(retryMatch[1]);
            console.error(`   - ${retrySeconds}초 후 재시도 가능합니다.`);
          }
        }
      } else {
        console.error(error);
      }

      console.error('\n');
      throw error;
    }
  }, 120000); // 2분 타임아웃
});
