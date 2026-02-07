import { ArkhamPortfolioService } from './module/arkham-portfolio';
import { startJob } from './util/startJob';

export function createArkhamPortfolioBatchBot() {
  const service = new ArkhamPortfolioService();

  return async function start() {
    await startJob(
      'arkham-portfolio batch bot',
      () => service.process(),
      60000 * 60 * 2, // 2시간마다 실행
    );
  };
}
