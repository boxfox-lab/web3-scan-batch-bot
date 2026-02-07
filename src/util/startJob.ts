import { sleep } from './sleep';
import { GlobalErrorHandler } from './error/global-error-handler';

export async function startJob(
  jobName: string,
  task: () => Promise<void>,
  interval = 1000,
) {
  do {
    try {
      await task();
    } catch (error) {
      if (error?.message?.includes('429')) {
        console.log(`[${jobName}] 429 에러 발생, 1분 뒤 재시도`);
        return;
      }

      // 전역 예외 핸들러를 사용하여 Discord로 전송
      await GlobalErrorHandler.handleError(error as Error, jobName);
      console.error(`[${jobName}]`, error);
    }
    await sleep(interval);
  } while (true);
}
