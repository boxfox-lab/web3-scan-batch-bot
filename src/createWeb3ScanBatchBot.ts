import OpenAI from 'openai';
import { Web3ScanService } from './module/web3-scan';
import { startJob } from './util/startJob';

export function createWeb3ScanBatchBot() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  const web3ScanService = new Web3ScanService(openai);

  return async function start() {
    await startJob(
      'web3-scan batch bot',
      () => web3ScanService.process(),
      3600000, // 1시간마다 체크
    );
  };
}
