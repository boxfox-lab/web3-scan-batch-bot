import axios from 'axios';
import { ArkhamPortfolioService } from './arkham-portfolio.service';
import {
  ARKHAM_ENTITIES,
  CHUNK_SIZE,
  SCRAPING_HOST,
  buildArkhamEntityUrl,
  buildScrapingScript,
} from './arkham-portfolio.constants';

jest.mock('axios');

describe('ArkhamPortfolioService', () => {
  let service: ArkhamPortfolioService;
  const mockedAxios = axios as jest.Mocked<typeof axios>;

  // 테스트 데이터 상수
  const MOCK_ENTITY = 'test-entity';
  const MOCK_SUCCESS_RESPONSE = {
    status: 200,
    data: { success: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ArkhamPortfolioService();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('process', () => {
    describe('성공 케이스', () => {
      it('모든 엔티티를 청크 단위로 병렬 처리해야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue(MOCK_SUCCESS_RESPONSE);

        // Act
        await service.process();

        // Assert
        const expectedChunks = Math.ceil(ARKHAM_ENTITIES.length / CHUNK_SIZE);
        expect(mockedAxios.post).toHaveBeenCalledTimes(ARKHAM_ENTITIES.length);

        // 각 엔티티에 대해 올바른 URL과 스크립트로 호출되었는지 확인
        ARKHAM_ENTITIES.forEach((entity) => {
          expect(mockedAxios.post).toHaveBeenCalledWith(
            SCRAPING_HOST,
            {
              url: buildArkhamEntityUrl(entity),
              script: buildScrapingScript(),
            },
            { timeout: 60000 },
          );
        });
      });

      it('첫 번째 청크의 모든 엔티티를 병렬로 처리해야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue(MOCK_SUCCESS_RESPONSE);
        const firstChunk = ARKHAM_ENTITIES.slice(0, CHUNK_SIZE);

        // Act
        await service.process();

        // Assert
        // 첫 번째 청크의 모든 엔티티가 처리되었는지 확인
        firstChunk.forEach((entity) => {
          expect(mockedAxios.post).toHaveBeenCalledWith(
            SCRAPING_HOST,
            expect.objectContaining({
              url: buildArkhamEntityUrl(entity),
            }),
            expect.any(Object),
          );
        });
      });

      it('여러 청크를 순차적으로 처리해야 한다', async () => {
        // Arrange
        const callOrder: string[] = [];
        mockedAxios.post.mockImplementation(async (url, data: any) => {
          const entity = data.url.split('/').pop();
          callOrder.push(entity);
          return MOCK_SUCCESS_RESPONSE;
        });

        const expectedChunks = Math.ceil(ARKHAM_ENTITIES.length / CHUNK_SIZE);

        // Act
        await service.process();

        // Assert
        expect(callOrder.length).toBe(ARKHAM_ENTITIES.length);

        // 청크 내에서는 순서가 보장되지 않지만, 청크 단위로는 순차 처리됨을 확인
        // 첫 번째 청크의 모든 엔티티가 두 번째 청크보다 먼저 처리되어야 함
        const firstChunkEntities = ARKHAM_ENTITIES.slice(0, CHUNK_SIZE);
        const secondChunkStart = CHUNK_SIZE;

        if (ARKHAM_ENTITIES.length > CHUNK_SIZE) {
          const firstChunkIndices = firstChunkEntities.map((entity) =>
            callOrder.indexOf(entity),
          );
          const maxFirstChunkIndex = Math.max(...firstChunkIndices);
          const firstSecondChunkIndex = callOrder.indexOf(
            ARKHAM_ENTITIES[secondChunkStart],
          );

          expect(maxFirstChunkIndex).toBeLessThan(firstSecondChunkIndex);
        }
      });

      it('각 엔티티에 대해 올바른 timeout 설정으로 요청해야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue(MOCK_SUCCESS_RESPONSE);

        // Act
        await service.process();

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Object),
          { timeout: 60000 },
        );
      });

      it('엔티티가 하나만 있을 때도 정상 처리해야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue(MOCK_SUCCESS_RESPONSE);
        const originalEntities = [...ARKHAM_ENTITIES];
        (ARKHAM_ENTITIES as any).length = 0;
        ARKHAM_ENTITIES.push('single-entity');

        // Act
        await service.process();

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledTimes(1);
        expect(mockedAxios.post).toHaveBeenCalledWith(
          SCRAPING_HOST,
          {
            url: buildArkhamEntityUrl('single-entity'),
            script: buildScrapingScript(),
          },
          { timeout: 60000 },
        );

        // Cleanup: 원래 배열 복원
        (ARKHAM_ENTITIES as any).length = 0;
        ARKHAM_ENTITIES.push(...originalEntities);
      });
    });

    describe('에러 케이스', () => {
      it('개별 엔티티 스크래핑 실패 시 에러를 로깅하고 계속 진행해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const errorEntity = ARKHAM_ENTITIES[0];

        mockedAxios.post.mockImplementation(async (url, data: any) => {
          const entity = data.url.split('/').pop();
          if (entity === errorEntity) {
            throw new Error('Scraping failed');
          }
          return MOCK_SUCCESS_RESPONSE;
        });

        // Act
        await service.process();

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          `[Arkham Portfolio] ${errorEntity} 실패:`,
          'Scraping failed',
        );
        // 나머지 엔티티들은 여전히 처리되어야 함
        expect(mockedAxios.post).toHaveBeenCalledTimes(ARKHAM_ENTITIES.length);

        consoleErrorSpy.mockRestore();
      });

      it('네트워크 에러 발생 시 에러 메시지를 로깅해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const networkError = new Error('Network timeout');
        mockedAxios.post.mockRejectedValue(networkError);

        // Act
        await service.process();

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(consoleErrorSpy.mock.calls[0][1]).toBe('Network timeout');

        consoleErrorSpy.mockRestore();
      });

      it('axios 에러 객체 발생 시 에러 메시지를 로깅해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const axiosError = {
          response: {
            status: 500,
            data: { error: 'Internal Server Error' },
          },
          message: 'Request failed with status code 500',
        };
        mockedAxios.post.mockRejectedValue(axiosError);

        // Act
        await service.process();

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalled();
        ARKHAM_ENTITIES.forEach((entity) => {
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            `[Arkham Portfolio] ${entity} 실패:`,
            'Request failed with status code 500',
          );
        });

        consoleErrorSpy.mockRestore();
      });

      it('Error 객체가 아닌 에러 발생 시 에러 자체를 로깅해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const stringError = 'String error message';
        mockedAxios.post.mockRejectedValue(stringError);

        // Act
        await service.process();

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalled();
        ARKHAM_ENTITIES.forEach((entity) => {
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            `[Arkham Portfolio] ${entity} 실패:`,
            stringError,
          );
        });

        consoleErrorSpy.mockRestore();
      });

      it('타임아웃 에러 발생 시 에러를 로깅해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const timeoutError = new Error('timeout of 60000ms exceeded');
        mockedAxios.post.mockRejectedValue(timeoutError);

        // Act
        await service.process();

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalled();
        ARKHAM_ENTITIES.forEach((entity) => {
          expect(consoleErrorSpy).toHaveBeenCalledWith(
            `[Arkham Portfolio] ${entity} 실패:`,
            'timeout of 60000ms exceeded',
          );
        });

        consoleErrorSpy.mockRestore();
      });

      it('청크 내 일부 엔티티 실패해도 나머지는 처리해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const failingEntities = ARKHAM_ENTITIES.slice(0, 2);

        mockedAxios.post.mockImplementation(async (url, data: any) => {
          const entity = data.url.split('/').pop();
          if (failingEntities.includes(entity)) {
            throw new Error('Failed');
          }
          return MOCK_SUCCESS_RESPONSE;
        });

        // Act
        await service.process();

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledTimes(failingEntities.length);
        expect(mockedAxios.post).toHaveBeenCalledTimes(ARKHAM_ENTITIES.length);

        consoleErrorSpy.mockRestore();
      });
    });

    describe('경계값 테스트', () => {
      it('CHUNK_SIZE와 정확히 일치하는 엔티티 개수일 때 정상 처리해야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue(MOCK_SUCCESS_RESPONSE);
        const originalEntities = [...ARKHAM_ENTITIES];
        (ARKHAM_ENTITIES as any).length = 0;
        for (let i = 0; i < CHUNK_SIZE; i++) {
          ARKHAM_ENTITIES.push(`entity-${i}`);
        }

        // Act
        await service.process();

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledTimes(CHUNK_SIZE);

        // Cleanup
        (ARKHAM_ENTITIES as any).length = 0;
        ARKHAM_ENTITIES.push(...originalEntities);
      });

      it('CHUNK_SIZE보다 1 많은 엔티티가 있을 때 2개 청크로 처리해야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue(MOCK_SUCCESS_RESPONSE);
        const originalEntities = [...ARKHAM_ENTITIES];
        (ARKHAM_ENTITIES as any).length = 0;
        for (let i = 0; i <= CHUNK_SIZE; i++) {
          ARKHAM_ENTITIES.push(`entity-${i}`);
        }

        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

        // Act
        await service.process();

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledTimes(CHUNK_SIZE + 1);
        // 2개의 청크 로그가 출력되어야 함
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('청크 1/2'),
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('청크 2/2'),
        );

        // Cleanup
        consoleLogSpy.mockRestore();
        (ARKHAM_ENTITIES as any).length = 0;
        ARKHAM_ENTITIES.push(...originalEntities);
      });

      it('빈 응답을 받아도 정상 처리해야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue({ status: 200, data: null });
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

        // Act
        await service.process();

        // Assert
        ARKHAM_ENTITIES.forEach((entity) => {
          expect(consoleLogSpy).toHaveBeenCalledWith(
            `[Arkham Portfolio] ${entity} 완료 (status: 200)`,
          );
        });

        consoleLogSpy.mockRestore();
      });

      it('다양한 HTTP 상태 코드를 받아도 정상 로깅해야 한다', async () => {
        // Arrange
        const statusCodes = [200, 201, 204];
        let currentStatusIndex = 0;

        mockedAxios.post.mockImplementation(async () => {
          const status = statusCodes[currentStatusIndex % statusCodes.length];
          currentStatusIndex++;
          return { status, data: {} };
        });

        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

        // Act
        await service.process();

        // Assert
        expect(consoleLogSpy).toHaveBeenCalled();
        // 다양한 상태 코드가 로깅되었는지 확인
        statusCodes.forEach((status) => {
          expect(consoleLogSpy).toHaveBeenCalledWith(
            expect.stringContaining(`(status: ${status})`),
          );
        });

        consoleLogSpy.mockRestore();
      });
    });

    describe('청크 처리 로직 테스트', () => {
      it('chunkArray 메서드가 올바르게 배열을 분할해야 한다', () => {
        // Arrange
        const testArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const chunkSize = 3;

        // Act
        const result = (service as any).chunkArray(testArray, chunkSize);

        // Assert
        expect(result).toEqual([
          [1, 2, 3],
          [4, 5, 6],
          [7, 8, 9],
          [10],
        ]);
      });

      it('chunkArray가 빈 배열을 처리해야 한다', () => {
        // Arrange
        const testArray: number[] = [];
        const chunkSize = 5;

        // Act
        const result = (service as any).chunkArray(testArray, chunkSize);

        // Assert
        expect(result).toEqual([]);
      });

      it('chunkArray가 크기 1로 분할해야 한다', () => {
        // Arrange
        const testArray = [1, 2, 3];
        const chunkSize = 1;

        // Act
        const result = (service as any).chunkArray(testArray, chunkSize);

        // Assert
        expect(result).toEqual([[1], [2], [3]]);
      });

      it('chunkArray가 배열보다 큰 청크 사이즈를 처리해야 한다', () => {
        // Arrange
        const testArray = [1, 2, 3];
        const chunkSize = 10;

        // Act
        const result = (service as any).chunkArray(testArray, chunkSize);

        // Assert
        expect(result).toEqual([[1, 2, 3]]);
      });
    });

    describe('scrapeEntity private 메서드 테스트', () => {
      it('성공 시 올바른 로그를 출력해야 한다', async () => {
        // Arrange
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
        mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

        // Act
        await (service as any).scrapeEntity(MOCK_ENTITY);

        // Assert
        expect(consoleLogSpy).toHaveBeenCalledWith(
          `[Arkham Portfolio] ${MOCK_ENTITY} 완료 (status: 200)`,
        );

        consoleLogSpy.mockRestore();
      });

      it('실패 시 올바른 에러 로그를 출력해야 한다', async () => {
        // Arrange
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        const errorMessage = 'Connection refused';
        mockedAxios.post.mockRejectedValue(new Error(errorMessage));

        // Act
        await (service as any).scrapeEntity(MOCK_ENTITY);

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          `[Arkham Portfolio] ${MOCK_ENTITY} 실패:`,
          errorMessage,
        );

        consoleErrorSpy.mockRestore();
      });

      it('올바른 URL로 스크래핑 요청을 보내야 한다', async () => {
        // Arrange
        mockedAxios.post.mockResolvedValue(MOCK_SUCCESS_RESPONSE);
        const expectedUrl = buildArkhamEntityUrl(MOCK_ENTITY);

        // Act
        await (service as any).scrapeEntity(MOCK_ENTITY);

        // Assert
        expect(mockedAxios.post).toHaveBeenCalledWith(
          SCRAPING_HOST,
          {
            url: expectedUrl,
            script: buildScrapingScript(),
          },
          { timeout: 60000 },
        );
      });
    });
  });
});
