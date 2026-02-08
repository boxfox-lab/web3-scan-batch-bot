import axios from 'axios';
import {
  ARKHAM_ENTITIES,
  CHUNK_SIZE,
  SCRAPING_HOST,
  buildArkhamEntityUrl,
  buildScrapingScript,
} from './arkham-portfolio.constants';
import { sendDiscordMessage } from '../../remotes/discord/sendDiscordMessage';

export class ArkhamPortfolioService {
  private readonly REQUEST_TIMEOUT = 60000; // 60초
  private readonly DISCORD_WEBHOOK_URL =
    process.env.DISCORD_DEV_WEBHOOK_URL || '';

  async process() {
    const startTime = new Date();
    console.log(
      `[Arkham Portfolio] 스크래핑 시작 (총 ${ARKHAM_ENTITIES.length}개 entity, ${CHUNK_SIZE}개씩 청크 병렬)`,
    );

    // 시작 알람
    await this.sendStartNotification();

    const chunks = this.chunkArray([...ARKHAM_ENTITIES], CHUNK_SIZE);
    const results = {
      success: [] as string[],
      failed: [] as string[],
    };

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(
        `[Arkham Portfolio] 청크 ${i + 1}/${chunks.length} 실행: [${chunk.join(
          ', ',
        )}]`,
      );

      const chunkResults = await Promise.all(
        chunk.map((entity) => this.scrapeEntity(entity)),
      );

      // 결과 집계
      chunkResults.forEach((result, idx) => {
        if (result.success) {
          results.success.push(chunk[idx]);
        } else {
          results.failed.push(chunk[idx]);
        }
      });
    }

    const duration = Date.now() - startTime.getTime();
    console.log('[Arkham Portfolio] 모든 entity 스크래핑 완료');

    // 완료 알람
    await this.sendCompletionNotification(results, duration);
  }

  private async scrapeEntity(
    entity: string,
  ): Promise<{ success: boolean; error?: string }> {
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

      // 성공 알람
      await this.sendSuccessNotification(entity);

      return { success: true };
    } catch (error) {
      let errorMessage: string;
      if (error && typeof error === 'object' && 'response' in error) {
        // axios 에러
        const axiosError = error as any;
        errorMessage = axiosError.response?.statusText || axiosError.message || String(error);
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }
      console.error(`[Arkham Portfolio] ${entity} 실패:`, errorMessage);

      // 실패 알람
      await this.sendFailureNotification(entity, errorMessage);

      return { success: false, error: errorMessage };
    }
  }

  private async sendStartNotification(): Promise<void> {
    if (!this.DISCORD_WEBHOOK_URL) return;

    try {
      await sendDiscordMessage(
        {
          embeds: [
            {
              title: '🚀 Arkham 포트폴리오 스크래핑 시작',
              description: `총 ${ARKHAM_ENTITIES.length}개 엔티티 스크래핑을 시작합니다.`,
              color: 0x3498db, // 파란색
              fields: [
                {
                  name: '대상 엔티티',
                  value: ARKHAM_ENTITIES.join(', '),
                  inline: false,
                },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        },
        this.DISCORD_WEBHOOK_URL,
      );
    } catch (error) {
      console.error('[Discord] 시작 알람 전송 실패:', error);
    }
  }

  private async sendSuccessNotification(entity: string): Promise<void> {
    if (!this.DISCORD_WEBHOOK_URL) return;

    try {
      await sendDiscordMessage(
        {
          embeds: [
            {
              title: `✅ ${entity} 스크래핑 성공`,
              color: 0x2ecc71, // 초록색
              timestamp: new Date().toISOString(),
            },
          ],
        },
        this.DISCORD_WEBHOOK_URL,
      );
    } catch (error) {
      console.error(`[Discord] ${entity} 성공 알람 전송 실패:`, error);
    }
  }

  private async sendFailureNotification(
    entity: string,
    errorMessage: string,
  ): Promise<void> {
    if (!this.DISCORD_WEBHOOK_URL) return;

    try {
      await sendDiscordMessage(
        {
          embeds: [
            {
              title: `❌ ${entity} 스크래핑 실패`,
              description: `\`\`\`${errorMessage}\`\`\``,
              color: 0xe74c3c, // 빨간색
              timestamp: new Date().toISOString(),
            },
          ],
        },
        this.DISCORD_WEBHOOK_URL,
      );
    } catch (error) {
      console.error(`[Discord] ${entity} 실패 알람 전송 실패:`, error);
    }
  }

  private async sendCompletionNotification(
    results: { success: string[]; failed: string[] },
    duration: number,
  ): Promise<void> {
    if (!this.DISCORD_WEBHOOK_URL) return;

    const total = results.success.length + results.failed.length;
    const successRate = ((results.success.length / total) * 100).toFixed(1);
    const durationMin = (duration / 1000 / 60).toFixed(1);

    try {
      await sendDiscordMessage(
        {
          embeds: [
            {
              title: '🏁 Arkham 포트폴리오 스크래핑 완료',
              description: `총 ${total}개 중 ${results.success.length}개 성공, ${results.failed.length}개 실패 (성공률: ${successRate}%)`,
              color: results.failed.length === 0 ? 0x2ecc71 : 0xf39c12, // 전부 성공: 초록, 일부 실패: 주황
              fields: [
                {
                  name: '✅ 성공',
                  value:
                    results.success.length > 0
                      ? results.success.join(', ')
                      : '없음',
                  inline: false,
                },
                {
                  name: '❌ 실패',
                  value:
                    results.failed.length > 0
                      ? results.failed.join(', ')
                      : '없음',
                  inline: false,
                },
                {
                  name: '⏱️ 소요 시간',
                  value: `${durationMin}분`,
                  inline: true,
                },
              ],
              timestamp: new Date().toISOString(),
            },
          ],
        },
        this.DISCORD_WEBHOOK_URL,
      );
    } catch (error) {
      console.error('[Discord] 완료 알람 전송 실패:', error);
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
