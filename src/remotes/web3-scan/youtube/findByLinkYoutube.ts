import { web3ScanRequester } from './web3ScanRequester';
import { YoutubeEntity } from './types';

export async function findByLinkYoutube(link: string): Promise<YoutubeEntity> {
  const response = await web3ScanRequester.get<YoutubeEntity>('/youtube/link', {
    params: { link: encodeURIComponent(link) },
  });
  return response.data;
}
