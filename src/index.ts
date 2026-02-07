import { createWeb3ScanBatchBot } from "./createWeb3ScanBatchBot";
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
    const start = createWeb3ScanBatchBot();
    await start();
  } catch (error) {
    await GlobalErrorHandler.handleError(error as Error, "main");
    process.exit(1);
  }
}

main();
