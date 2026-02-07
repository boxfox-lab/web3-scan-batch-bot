import {
  GoogleGenAI,
  JobState,
  BatchJob,
  InlinedResponse,
  CreateBatchJobConfig,
} from '@google/genai';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Storage } from '@google-cloud/storage';
import { uploadImage } from '../../remotes/image';
import { GlobalErrorHandler } from '../../util/error/global-error-handler';

// BatchJob에 outputConfig와 outputInfo 필드가 있을 수 있으므로 확장된 타입 정의
interface BatchJobWithOutputInfo extends BatchJob {
  outputConfig?: {
    gcsDestination?: {
      outputUriPrefix?: string;
    };
  };
  outputInfo?: {
    gcsOutputDirectory?: string;
  };
}

export interface BatchImageRequest {
  key?: string;
  prompt: string;
}

export interface BatchImageResult {
  index: number;
  key?: string;
  imageUrl: string | null;
  success: boolean;
  error?: string;
}

export interface BatchImageGenerationOptions {
  prompts: BatchImageRequest[];
  model?: string;
  displayName?: string;
  maxWaitTime?: number; // milliseconds
  checkInterval?: number; // milliseconds
  autoDelete?: boolean; // 완료 후 자동 삭제 여부
}

export class GeminiImageBatchService {
  private genAIBatch: GoogleGenAI;
  private storage: Storage | null = null;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.');
    }
    this.genAIBatch = new GoogleGenAI({ apiKey: key });

    // GCS 경로가 설정된 경우 Storage 클라이언트 초기화
    if (process.env.GEMINI_BATCH_OUTPUT_GCS_PATH) {
      try {
        this.storage = new Storage();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : '알 수 없는 오류';
        console.warn(
          `[GeminiImageBatch] GCS Storage 클라이언트 초기화 실패: ${errorMessage}`,
        );
      }
    }
  }

  /**
   * 처리중인 배치 작업이 있는지 확인합니다.
   */
  async hasProcessingBatchJob(displayName?: string): Promise<BatchJob | null> {
    try {
      const batchJobs = await this.genAIBatch.batches.list({
        config: { pageSize: 10 },
      });

      for await (const job of batchJobs) {
        const state = job.state;
        // 실행중인 작업 확인
        if (
          state === JobState.JOB_STATE_PENDING ||
          state === JobState.JOB_STATE_RUNNING ||
          state === JobState.JOB_STATE_QUEUED
        ) {
          // displayName으로 매칭하거나, Image-Batch가 포함된 작업 확인
          if (
            (displayName && job.displayName === displayName) ||
            job.displayName?.includes('Image-Batch')
          ) {
            console.log(
              `[GeminiImageBatch] 처리중인 배치 작업 발견: ${job.name} (상태: ${state})`,
            );
            return job;
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      console.log(`[GeminiImageBatch] 기존 작업 조회 실패: ${errorMessage}`);
    }

    return null;
  }

  /**
   * 완료되거나 실패한 배치 작업이 있는지 확인합니다.
   */
  async findCompletedOrFailedBatchJob(
    displayName?: string,
  ): Promise<BatchJob | null> {
    try {
      const batchJobs = await this.genAIBatch.batches.list({
        config: { pageSize: 10 },
      });

      for await (const job of batchJobs) {
        const state = job.state;
        // 완료되거나 실패한 작업 확인
        if (
          state === JobState.JOB_STATE_SUCCEEDED ||
          state === JobState.JOB_STATE_PARTIALLY_SUCCEEDED ||
          state === JobState.JOB_STATE_FAILED ||
          state === JobState.JOB_STATE_CANCELLED
        ) {
          // displayName으로 매칭하거나, Image-Batch가 포함된 작업 확인
          if (
            (displayName && job.displayName === displayName) ||
            job.displayName?.includes('Image-Batch')
          ) {
            console.log(
              `[GeminiImageBatch] 완료/실패된 배치 작업 발견: ${job.name} (상태: ${state})`,
            );
            return job;
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      console.log(`[GeminiImageBatch] 기존 작업 조회 실패: ${errorMessage}`);
    }

    return null;
  }

  /**
   * 기존 배치 작업을 찾거나 새로 생성합니다.
   */
  async findOrCreateBatchJob(
    prompts: BatchImageRequest[],
    displayName?: string,
    model = 'gemini-3-pro-image-preview', // 주의: 이미지 생성 모델은 'imagen-3' 또는 'imagen-3-fast'일 수 있음
  ): Promise<BatchJob> {
    // 기존 배치 작업 조회
    try {
      const batchJobs = await this.genAIBatch.batches.list({
        config: { pageSize: 10 },
      });

      for await (const job of batchJobs) {
        const state = job.state;
        console.log(
          `[GeminiImageBatch] 발견된 작업: ${
            job.name
          }, 상태: ${state}, 표시명: ${job.displayName || 'N/A'}`,
        );

        // 실행중이거나 완료된 작업이 있으면 사용
        if (
          state === JobState.JOB_STATE_PENDING ||
          state === JobState.JOB_STATE_RUNNING ||
          state === JobState.JOB_STATE_SUCCEEDED ||
          state === JobState.JOB_STATE_PARTIALLY_SUCCEEDED
        ) {
          // displayName으로 매칭하거나, Image-Batch가 포함된 작업 사용
          if (
            (displayName && job.displayName === displayName) ||
            job.displayName?.includes('Image-Batch')
          ) {
            console.log(
              `[GeminiImageBatch] 기존 배치 작업 사용: ${job.name} (상태: ${state})`,
            );
            return job;
          }
        }
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      console.log(
        `[GeminiImageBatch] 기존 작업 조회 실패 (새 작업 생성): ${errorMessage}`,
      );
    }

    // 기존 작업이 없으면 새로 생성
    console.log('[GeminiImageBatch] 새 배치 작업 생성 중...');

    // outputConfig 설정 (GCS 경로가 환경 변수로 제공된 경우)
    const gcsOutputPath = process.env.GEMINI_BATCH_OUTPUT_GCS_PATH;
    const batchConfig: CreateBatchJobConfig & {
      outputConfig?: {
        gcsDestination?: {
          outputUriPrefix?: string;
        };
      };
    } = {
      displayName: displayName || 'Image-Batch',
    };

    // GCS 경로가 설정된 경우 outputConfig 추가
    if (gcsOutputPath) {
      // 핵심: config 객체 안에 outputConfig를 계층적으로 넣어야 합니다.
      // 경로가 /로 끝나지 않으면 추가
      const normalizedPath = gcsOutputPath.endsWith('/')
        ? gcsOutputPath
        : `${gcsOutputPath}/`;
      batchConfig.outputConfig = {
        gcsDestination: {
          outputUriPrefix: normalizedPath,
        },
      };
      console.log(`[GeminiImageBatch] GCS 출력 경로 설정: ${normalizedPath}`);
    } else {
      console.warn(
        '[GeminiImageBatch] GCS 출력 경로가 설정되지 않았습니다. 환경 변수 GEMINI_BATCH_OUTPUT_GCS_PATH를 설정하세요.',
      );
      console.warn(
        '[GeminiImageBatch] 이미지 모델은 대부분 GCS를 요구하므로 결과를 가져올 수 없을 수 있습니다.',
      );
    }

    // 배치 작업 생성 (custom_id를 포함하여 순서 매칭 가능하도록)
    const batchJob = await this.genAIBatch.batches.create({
      model,
      src: prompts.map((req, index) => ({
        contents: [{ parts: [{ text: req.prompt }] }],
        config: {
          responseModalities: ['IMAGE'],
        },
        // custom_id를 추가하여 결과 매칭 가능하도록 (key가 있으면 사용, 없으면 인덱스 사용)
        customId: req.key || `request-${index}`,
      })),
      config: batchConfig,
    });

    console.log(`[GeminiImageBatch] 배치 작업 생성 완료! ID: ${batchJob.name}`);
    return batchJob;
  }

  /**
   * 배치 작업만 생성합니다 (기존 작업 찾기 없이 항상 새로 생성).
   * 주기적으로 체크하여 처리하는 경우 사용합니다.
   */
  async createBatchJobOnly(
    prompts: BatchImageRequest[],
    displayName?: string,
    model = 'gemini-3-pro-image-preview',
  ): Promise<BatchJob> {
    console.log('[GeminiImageBatch] 새 배치 작업 생성 중...');

    // outputConfig 설정 (GCS 경로가 환경 변수로 제공된 경우)
    const gcsOutputPath = process.env.GEMINI_BATCH_OUTPUT_GCS_PATH;
    const batchConfig: CreateBatchJobConfig & {
      outputConfig?: {
        gcsDestination?: {
          outputUriPrefix?: string;
        };
      };
    } = {
      displayName: displayName || 'Image-Batch',
    };

    // GCS 경로가 설정된 경우 outputConfig 추가
    if (gcsOutputPath) {
      // 핵심: config 객체 안에 outputConfig를 계층적으로 넣어야 합니다.
      // 경로가 /로 끝나지 않으면 추가
      const normalizedPath = gcsOutputPath.endsWith('/')
        ? gcsOutputPath
        : `${gcsOutputPath}/`;
      batchConfig.outputConfig = {
        gcsDestination: {
          outputUriPrefix: normalizedPath,
        },
      };
      console.log(`[GeminiImageBatch] GCS 출력 경로 설정: ${normalizedPath}`);
    } else {
      console.warn(
        '[GeminiImageBatch] GCS 출력 경로가 설정되지 않았습니다. 환경 변수 GEMINI_BATCH_OUTPUT_GCS_PATH를 설정하세요.',
      );
      console.warn(
        '[GeminiImageBatch] 이미지 모델은 대부분 GCS를 요구하므로 결과를 가져올 수 없을 수 있습니다.',
      );
    }

    const batchJob = await this.genAIBatch.batches.create({
      model,
      src: prompts.map((req, index) => ({
        contents: [{ parts: [{ text: req.prompt }] }],
        config: {
          responseModalities: ['IMAGE'],
        },
        // custom_id를 추가하여 결과 매칭 가능하도록 (key가 있으면 사용, 없으면 인덱스 사용)
        customId: req.key || `request-${index}`,
      })),
      config: batchConfig,
    });

    console.log(`[GeminiImageBatch] 배치 작업 생성 완료! ID: ${batchJob.name}`);
    return batchJob;
  }

  /**
   * 배치 작업이 완료될 때까지 대기합니다.
   */
  async waitForBatchCompletion(
    batchJob: BatchJob,
    maxWaitTime = 300000, // 5분
    checkInterval = 5000, // 5초
  ): Promise<BatchJob> {
    let batchStatus = batchJob.state;

    // 이미 완료된 작업이면 바로 반환
    if (
      batchStatus === JobState.JOB_STATE_SUCCEEDED ||
      batchStatus === JobState.JOB_STATE_PARTIALLY_SUCCEEDED
    ) {
      console.log(`[GeminiImageBatch] 배치 작업이 이미 완료됨: ${batchStatus}`);
      return batchJob;
    }

    // 실행중인 작업이면 완료될 때까지 대기
    const startWaitTime = Date.now();

    while (
      batchStatus === JobState.JOB_STATE_PENDING ||
      batchStatus === JobState.JOB_STATE_RUNNING ||
      batchStatus === JobState.JOB_STATE_QUEUED
    ) {
      if (Date.now() - startWaitTime > maxWaitTime) {
        throw new Error('배치 작업 완료 대기 시간 초과');
      }

      await new Promise((resolve) => setTimeout(resolve, checkInterval));

      if (!batchJob.name) {
        throw new Error('배치 작업 이름이 없습니다.');
      }

      const statusData = await this.genAIBatch.batches.get({
        name: batchJob.name,
      });

      batchStatus = statusData.state || JobState.JOB_STATE_UNSPECIFIED;
      console.log(`[GeminiImageBatch] 배치 상태: ${batchStatus}`);

      if (
        batchStatus === JobState.JOB_STATE_SUCCEEDED ||
        batchStatus === JobState.JOB_STATE_PARTIALLY_SUCCEEDED
      ) {
        return statusData;
      } else if (
        batchStatus === JobState.JOB_STATE_FAILED ||
        batchStatus === JobState.JOB_STATE_CANCELLED
      ) {
        throw new Error(
          `배치 작업 실패: ${statusData.error?.message || 'Unknown error'}`,
        );
      }
    }

    return batchJob;
  }

  /**
   * 배치 작업 결과를 처리하고 이미지를 업로드합니다.
   */
  async processBatchResults(
    batchJob: BatchJob,
    prompts: BatchImageRequest[],
  ): Promise<BatchImageResult[]> {
    const results: BatchImageResult[] = [];

    // 배치 작업 데이터를 JSON 파일로 저장 (디버깅용)
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jsonFileName = `gemini-batch-job-${timestamp}.json`;
      const jsonFilePath = join(process.cwd(), jsonFileName);
      await writeFile(jsonFilePath, JSON.stringify(batchJob, null, 2), 'utf-8');
      console.log(`[GeminiImageBatch] 배치 작업 데이터 저장: ${jsonFilePath}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : '알 수 없는 오류';
      console.error(
        `[GeminiImageBatch] 배치 작업 데이터 저장 실패: ${errorMessage}`,
      );
    }

    // 전체 응답 객체를 로그로 출력 (디버깅용)
    console.log(
      '[GeminiImageBatch] Full Job Response:',
      JSON.stringify(batchJob, null, 2),
    );

    // 배치 결과 가져오기: 파일 또는 인라인 응답
    let responses: InlinedResponse[] = [];

    // 1. 인라인 응답 확인 (인라인 요청 사용 시)
    if (batchJob.dest?.inlinedResponses) {
      responses = batchJob.dest.inlinedResponses;
      console.log(`[GeminiImageBatch] 인라인 응답 사용: ${responses.length}개`);
    }
    // 2. 파일에서 결과 읽기 (파일 기반 배치 작업)
    else if (batchJob.dest?.fileName) {
      console.log(
        `[GeminiImageBatch] 결과 파일에서 읽기: ${batchJob.dest.fileName}`,
      );
      responses = await this.downloadAndParseBatchFile(batchJob.dest.fileName);
      console.log(
        `[GeminiImageBatch] 파일에서 파싱된 응답: ${responses.length}개`,
      );
    }
    // 3. GCS에서 결과 파일 읽기 (outputConfig 또는 outputInfo 필드 확인)
    else {
      const jobWithOutput = batchJob as BatchJobWithOutputInfo;
      const gcsPath =
        jobWithOutput.outputInfo?.gcsOutputDirectory ||
        jobWithOutput.outputConfig?.gcsDestination?.outputUriPrefix ||
        process.env.GEMINI_BATCH_OUTPUT_GCS_PATH;

      if (gcsPath && this.storage) {
        console.log(
          `[GeminiImageBatch] GCS 경로에서 결과 파일 읽기: ${gcsPath}`,
        );
        try {
          responses = await this.downloadAndParseBatchFileFromGCS(gcsPath);
          console.log(
            `[GeminiImageBatch] GCS에서 파싱된 응답: ${responses.length}개`,
          );
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : '알 수 없는 오류';
          console.error(
            `[GeminiImageBatch] GCS에서 파일 읽기 실패: ${errorMessage}`,
          );
          // GCS 읽기 실패 시에도 계속 진행 (다른 방법 시도)
        }
      } else if (jobWithOutput.outputConfig || jobWithOutput.outputInfo) {
        console.log(
          `[GeminiImageBatch] outputConfig 발견:`,
          JSON.stringify(jobWithOutput.outputConfig, null, 2),
        );
        console.log(
          `[GeminiImageBatch] outputInfo 발견:`,
          JSON.stringify(jobWithOutput.outputInfo, null, 2),
        );
      }
    }

    console.log(
      `[GeminiImageBatch] 배치 작업 구조 확인 - dest: ${!!batchJob.dest}, fileName: ${
        batchJob.dest?.fileName
      }, inlinedResponses: ${batchJob.dest?.inlinedResponses?.length || 0}개`,
    );
    console.log(
      `[GeminiImageBatch] 배치 작업 전체 키: ${Object.keys(batchJob).join(
        ', ',
      )}`,
    );

    if (responses.length === 0) {
      const errorMessage =
        '배치 결과가 비어있습니다. 배치 작업이 완료되지 않았거나 결과를 가져올 수 없습니다.';
      console.error(`[GeminiImageBatch] ${errorMessage}`);

      // 배치 결과가 비어있으면 해당 작업 삭제
      try {
        console.log(
          `[GeminiImageBatch] 결과가 비어있어 배치 작업 삭제 시도: ${batchJob.name}`,
        );
        await this.deleteBatchJob(batchJob);
        console.log(`[GeminiImageBatch] 배치 작업 삭제 완료`);
      } catch (deleteError: unknown) {
        const deleteErrorMessage =
          deleteError instanceof Error
            ? deleteError.message
            : '알 수 없는 오류';
        console.error(
          `[GeminiImageBatch] 배치 작업 삭제 실패: ${deleteErrorMessage}`,
        );
        // 삭제 실패해도 원래 에러는 던짐
      }

      throw new Error(errorMessage);
    }

    // 결과와 요청을 매칭 (순서 불일치 문제 해결)
    const matchedResults = this.matchResponsesToPrompts(responses, prompts);

    for (let i = 0; i < matchedResults.length; i++) {
      const { response, prompt, originalIndex } = matchedResults[i];
      const requestKey = prompt?.key || `request-${originalIndex + 1}`;

      try {
        if (response.error) {
          const errorMessage = response.error.message || 'Unknown error';
          throw new Error(errorMessage);
        }

        if (!response.response) {
          throw new Error('응답 데이터가 없습니다.');
        }

        // 이미지 데이터 추출
        const parts = response.response.candidates?.[0]?.content?.parts || [];
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

        // 이미지 업로드
        const imageUrl = await uploadImage(artifacts.data);

        console.log(
          `[GeminiImageBatch] 이미지 ${
            originalIndex + 1
          } 생성 완료: ${imageUrl}`,
        );

        results.push({
          index: originalIndex + 1,
          key: requestKey,
          imageUrl,
          success: true,
        });
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(
          `[GeminiImageBatch] 이미지 ${originalIndex + 1} 처리 실패:`,
          errorMessage,
        );
        results.push({
          index: originalIndex + 1,
          key: requestKey,
          imageUrl: null,
          success: false,
          error: errorMessage,
        });
      }
    }

    // 원래 순서대로 정렬
    results.sort((a, b) => a.index - b.index);

    return results;
  }

  /**
   * GCS에서 배치 결과 파일을 다운로드하고 JSONL 형식으로 파싱합니다.
   */
  private async downloadAndParseBatchFileFromGCS(
    gcsPath: string,
  ): Promise<InlinedResponse[]> {
    if (!this.storage) {
      throw new Error('GCS Storage 클라이언트가 초기화되지 않았습니다.');
    }

    // gs://bucket-name/path/to/file 형식에서 버킷과 경로 추출
    const gcsUriMatch = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!gcsUriMatch) {
      throw new Error(`잘못된 GCS 경로 형식: ${gcsPath}`);
    }

    const [, bucketName, pathPrefix] = gcsUriMatch;
    const bucket = this.storage.bucket(bucketName);

    console.log(
      `[GeminiImageBatch] GCS 버킷에서 파일 검색: ${bucketName}/${pathPrefix}`,
    );

    // 경로에 있는 모든 .jsonl 파일 찾기
    const [files] = await bucket.getFiles({ prefix: pathPrefix });
    const jsonlFiles = files.filter((file) => file.name.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      throw new Error(
        `GCS 경로에서 .jsonl 파일을 찾을 수 없습니다: ${gcsPath}`,
      );
    }

    console.log(`[GeminiImageBatch] 발견된 JSONL 파일: ${jsonlFiles.length}개`);

    // 모든 JSONL 파일의 내용을 합쳐서 파싱
    const allResponses: InlinedResponse[] = [];
    for (const file of jsonlFiles) {
      console.log(`[GeminiImageBatch] 파일 읽기: ${file.name}`);
      const [fileContent] = await file.download();
      const content = fileContent.toString('utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          allResponses.push({
            response: parsed,
            error: undefined,
          });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : '알 수 없는 오류';
          console.error(
            `[GeminiImageBatch] JSONL 라인 파싱 실패: ${errorMessage}`,
          );
          allResponses.push({
            response: undefined,
            error: {
              message: `JSON 파싱 실패: ${errorMessage}`,
              code: 400,
            },
          });
        }
      }
    }

    return allResponses;
  }

  /**
   * 배치 결과 파일을 다운로드하고 JSONL 형식으로 파싱합니다.
   * (Gemini가 관리하는 파일용)
   */
  private async downloadAndParseBatchFile(
    fileName: string,
  ): Promise<InlinedResponse[]> {
    const tempFilePath = join(tmpdir(), `gemini-batch-${Date.now()}.jsonl`);

    try {
      // 파일 다운로드
      await this.genAIBatch.files.download({
        file: fileName,
        downloadPath: tempFilePath,
      });

      // JSONL 파일 읽기
      const fileContent = await readFile(tempFilePath, 'utf-8');
      const lines = fileContent.split('\n').filter((line) => line.trim());

      // 각 라인을 JSON으로 파싱하여 InlinedResponse 형식으로 변환
      const responses: InlinedResponse[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          // GenerateContentResponse 형식을 InlinedResponse 형식으로 변환
          responses.push({
            response: parsed,
            error: undefined,
          });
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : '알 수 없는 오류';
          console.error(
            `[GeminiImageBatch] JSONL 라인 파싱 실패: ${errorMessage}`,
          );
          // 파싱 실패한 라인은 에러로 처리
          responses.push({
            response: undefined,
            error: {
              message: `JSON 파싱 실패: ${errorMessage}`,
              code: 400,
            },
          });
        }
      }

      return responses;
    } finally {
      // 임시 파일 삭제
      try {
        await unlink(tempFilePath);
      } catch (error) {
        // 파일 삭제 실패는 무시
        console.warn(`[GeminiImageBatch] 임시 파일 삭제 실패: ${tempFilePath}`);
      }
    }
  }

  /**
   * 응답과 프롬프트를 매칭합니다 (순서 불일치 문제 해결).
   * custom_id를 우선 사용하고, 없으면 인덱스 기반으로 매칭합니다.
   */
  private matchResponsesToPrompts(
    responses: InlinedResponse[],
    prompts: BatchImageRequest[],
  ): Array<{
    response: InlinedResponse;
    prompt: BatchImageRequest;
    originalIndex: number;
  }> {
    const matched: Array<{
      response: InlinedResponse;
      prompt: BatchImageRequest;
      originalIndex: number;
    }> = [];
    const usedIndices = new Set<number>();

    // 프롬프트 인덱스 맵 생성 (key 또는 인덱스 기반)
    const promptMap = new Map<string, number>();
    prompts.forEach((prompt, index) => {
      const id = prompt.key || `request-${index}`;
      promptMap.set(id, index);
    });

    // 각 응답에 대해 custom_id로 매칭 시도
    for (const response of responses) {
      if (response.error || !response.response) {
        // 에러가 있거나 응답이 없으면 첫 번째 사용 가능한 프롬프트와 매칭
        for (let i = 0; i < prompts.length; i++) {
          if (!usedIndices.has(i)) {
            matched.push({
              response,
              prompt: prompts[i],
              originalIndex: i,
            });
            usedIndices.add(i);
            break;
          }
        }
        continue;
      }

      // custom_id 추출 시도 (응답의 메타데이터에서)
      const customId =
        (response.response as any).customId ||
        (response.response as any).custom_id ||
        null;

      let matchedIndex: number | null = null;

      // custom_id로 매칭 시도
      if (customId && promptMap.has(customId)) {
        const index = promptMap.get(customId);
        if (index !== undefined && !usedIndices.has(index)) {
          matchedIndex = index;
          usedIndices.add(index);
        }
      }

      // custom_id 매칭 실패 시 순서대로 할당
      if (matchedIndex === null) {
        for (let i = 0; i < prompts.length; i++) {
          if (!usedIndices.has(i)) {
            matchedIndex = i;
            usedIndices.add(i);
            break;
          }
        }
      }

      if (matchedIndex !== null) {
        matched.push({
          response,
          prompt: prompts[matchedIndex],
          originalIndex: matchedIndex,
        });
      }
    }

    // 매칭되지 않은 프롬프트가 있으면 에러 응답으로 추가
    for (let i = 0; i < prompts.length; i++) {
      if (!usedIndices.has(i)) {
        matched.push({
          response: {
            response: undefined,
            error: {
              message: '응답을 찾을 수 없습니다.',
              code: 404,
            },
          },
          prompt: prompts[i],
          originalIndex: i,
        });
      }
    }

    return matched;
  }

  /**
   * 배치 작업 상태를 가져옵니다.
   */
  async getBatchJob(jobName: string): Promise<BatchJob> {
    return await this.genAIBatch.batches.get({ name: jobName });
  }

  /**
   * 완료된 배치 작업을 삭제합니다.
   */
  async deleteBatchJob(batchJob: BatchJob): Promise<void> {
    if (!batchJob.name) {
      throw new Error('배치 작업 이름이 없습니다.');
    }

    const state = batchJob.state;
    if (
      state === JobState.JOB_STATE_SUCCEEDED ||
      state === JobState.JOB_STATE_PARTIALLY_SUCCEEDED ||
      state === JobState.JOB_STATE_FAILED ||
      state === JobState.JOB_STATE_CANCELLED
    ) {
      try {
        console.log(`[GeminiImageBatch] 배치 작업 삭제 중: ${batchJob.name}`);
        await this.genAIBatch.batches.delete({ name: batchJob.name });
        console.log(`[GeminiImageBatch] 배치 작업 삭제 완료`);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : '알 수 없는 오류';
        console.error(
          `[GeminiImageBatch] 배치 작업 삭제 실패: ${errorMessage}`,
        );
        throw error instanceof Error ? error : new Error(errorMessage);
      }
    } else {
      console.warn(
        `[GeminiImageBatch] 배치 작업이 완료되지 않아 삭제하지 않습니다. 상태: ${state}`,
      );
    }
  }

  /**
   * 배치 이미지 생성을 전체 프로세스로 실행합니다.
   */
  async generateBatchImages(
    options: BatchImageGenerationOptions,
  ): Promise<BatchImageResult[]> {
    const {
      prompts,
      model = 'gemini-3-pro-image-preview',
      displayName = 'Image-Batch',
      maxWaitTime = 300000,
      checkInterval = 5000,
      autoDelete = false,
    } = options;

    let completedJob: BatchJob | null = null;

    try {
      // 1. 배치 작업 찾기 또는 생성
      const batchJob = await this.findOrCreateBatchJob(
        prompts,
        displayName,
        model,
      );

      // 2. 완료 대기
      completedJob = await this.waitForBatchCompletion(
        batchJob,
        maxWaitTime,
        checkInterval,
      );

      // 3. 결과 처리
      const results = await this.processBatchResults(completedJob, prompts);

      // 4. 완료된 작업 삭제 (옵션, 에러 없을 때만)
      if (autoDelete && completedJob) {
        await this.deleteBatchJob(completedJob);
      }

      return results;
    } catch (error) {
      console.error('[GeminiImageBatch] 배치 이미지 생성 실패:', error);
      if (completedJob) {
        console.error(
          `[GeminiImageBatch] 에러 발생으로 인해 배치 작업을 삭제하지 않습니다. 작업 ID: ${completedJob.name}`,
        );
      }
      await GlobalErrorHandler.handleError(
        error as Error,
        'GeminiImageBatchService.generateBatchImages',
        { promptsCount: prompts.length },
      );
      throw error;
    }
  }
}
