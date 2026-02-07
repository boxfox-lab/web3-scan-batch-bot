import axios from 'axios';
import { web3ScanRequester } from './web3ScanRequester';
import { YoutubeEntity } from './types';
import { sleep } from '../../../util/sleep';

/**
 * 429 에러 발생 시 재시도하는 findAllYoutube 함수
 * Exponential backoff를 사용하여 재시도합니다.
 */
export async function findAllYoutube(
  channelId?: string,
): Promise<YoutubeEntity[]> {
  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      const response = await web3ScanRequester.get<YoutubeEntity[]>(
        '/youtube',
        {
          params: channelId ? { channelId } : undefined,
        },
      );
      return response.data;
    } catch (error) {
      // 429 에러인지 확인
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        retryCount++;

        if (retryCount >= maxRetries) {
          console.error(
            `[findAllYoutube] 429 에러: ${maxRetries}번 재시도 후 실패`,
          );
          throw new Error(
            `Rate limit exceeded: ${maxRetries}번 재시도 후에도 실패했습니다.`,
          );
        }

        // Exponential backoff: 2^retryCount 초 (최대 60초)
        const waitTime = Math.min(Math.pow(2, retryCount) * 1000, 60000);
        console.warn(
          `[findAllYoutube] 429 에러 발생 (시도 ${retryCount}/${maxRetries}). ${
            waitTime / 1000
          }초 후 재시도...`,
        );

        // Retry-After 헤더가 있으면 그 값을 사용
        const retryAfter = error.response?.headers['retry-after'];
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
            const retryAfterMs = retryAfterSeconds * 1000;
            console.warn(
              `[findAllYoutube] Retry-After 헤더에 따라 ${retryAfterSeconds}초 대기`,
            );
            await sleep(retryAfterMs);
            continue;
          }
        }

        await sleep(waitTime);
        continue;
      }

      // 429가 아닌 다른 에러는 즉시 throw
      throw error;
    }
  }

  // 이 코드는 실행되지 않아야 하지만 타입 안전성을 위해 추가
  throw new Error('findAllYoutube: 예상치 못한 오류');
}
