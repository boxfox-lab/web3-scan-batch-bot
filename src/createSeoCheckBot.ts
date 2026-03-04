import { SeoCheckService } from './module/seo-check';
import { startJob } from './util/startJob';

export function createSeoCheckBot() {
  const service = new SeoCheckService();

  return async function start() {
    await startJob(
      'seo-check bot',
      () => service.process(),
      60000 * 60 * 24, // 24시간마다 실행
    );
  };
}
