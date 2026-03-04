import "dotenv/config";
import { createWeb3ScanBatchBot } from "./createWeb3ScanBatchBot";
import { createArkhamPortfolioBatchBot } from "./createArkhamPortfolioBatchBot";
import { createSeoCheckBot } from "./createSeoCheckBot";
import { GlobalErrorHandler } from "./util/error/global-error-handler";

process.on("uncaughtException", async (error) => {
  await GlobalErrorHandler.handleError(error, "UncaughtException");
  process.exit(1);
});

process.on("unhandledRejection", async (reason, promise) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  await GlobalErrorHandler.handleError(error, "UnhandledRejection", {
    promise,
  });
  process.exit(1);
});

async function main() {
  try {
    // const start1 = createWeb3ScanBatchBot();
    const start2 = createArkhamPortfolioBatchBot();
    const start3 = createSeoCheckBot();
    await Promise.all([
      // start1(), // web3-scan 영상 요약, Gemini 이미지 생성 (임시 비활성화)
      start2(), // arkham-portfolio 스크래핑
      start3(), // 일일 SEO 점검
    ]);
  } catch (error) {
    await GlobalErrorHandler.handleError(error as Error, "main");
    process.exit(1);
  }
}

main();
