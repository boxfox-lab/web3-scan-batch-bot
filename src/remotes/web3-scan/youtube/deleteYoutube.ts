import { web3ScanRequester } from './web3ScanRequester';

export async function deleteYoutube(link: string): Promise<void> {
  await web3ScanRequester.delete(`/youtube/${encodeURIComponent(link)}`);
}
