import axios from 'axios';
import {
  ARKHAM_ENTITIES,
  CHUNK_SIZE,
  SCRAPING_HOST,
  buildArkhamEntityUrl,
  buildScrapingScript,
} from './arkham-portfolio.constants';

export class ArkhamPortfolioService {
  private readonly REQUEST_TIMEOUT = 60000; // 60초

  async process() {
    console.log(
      `[Arkham Portfolio] 스크래핑 시작 (총 ${ARKHAM_ENTITIES.length}개 entity, ${CHUNK_SIZE}개씩 청크 병렬)`,
    );

    const chunks = this.chunkArray([...ARKHAM_ENTITIES], CHUNK_SIZE);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(
        `[Arkham Portfolio] 청크 ${i + 1}/${chunks.length} 실행: [${chunk.join(
          ', ',
        )}]`,
      );

      await Promise.all(chunk.map((entity) => this.scrapeEntity(entity)));
    }

    console.log('[Arkham Portfolio] 모든 entity 스크래핑 완료');
  }

  private async scrapeEntity(entity: string): Promise<void> {
    const url = buildArkhamEntityUrl(entity);

    try {
      const response = await axios.post(
        SCRAPING_HOST,
        {
          url,
          script: buildScrapingScript(),
        },
        { timeout: this.REQUEST_TIMEOUT },
      );

      console.log(
        `[Arkham Portfolio] ${entity} 완료 (status: ${response.status})`,
      );
    } catch (error) {
      console.error(
        `[Arkham Portfolio] ${entity} 실패:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
