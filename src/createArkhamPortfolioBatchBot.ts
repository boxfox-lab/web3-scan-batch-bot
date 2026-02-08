import { ArkhamPortfolioService } from './module/arkham-portfolio';
import { ScrapingUrlService } from './config/scraping-url.service';
import { startJob } from './util/startJob';

export function createArkhamPortfolioBatchBot() {
  const scrapingUrlService = new ScrapingUrlService();
  const service = new ArkhamPortfolioService(scrapingUrlService);

  return async function start() {
    await startJob(
      'arkham-portfolio batch bot',
      () => service.process(),
      60000 * 60 * 2, // 2시간마다 실행
    );
  };
}
