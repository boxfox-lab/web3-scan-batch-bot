import { web3ScanRequester } from './web3ScanRequester';
import { CreateYoutubeDto, YoutubeEntity } from './types';

export async function createYoutube(
  dto: CreateYoutubeDto | CreateYoutubeDto[],
): Promise<YoutubeEntity | YoutubeEntity[]> {
  const response = await web3ScanRequester.post<
    YoutubeEntity | YoutubeEntity[]
  >('/youtube', dto, {
    headers: {
      'X-API-KEY': process.env.WEB3_SCAN_API_KEY,
    },
  });
  return response.data;
}
