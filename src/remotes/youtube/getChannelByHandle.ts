import axios from 'axios';
import { sendExceptionToDiscord } from '../discord/sendExceptionToDiscord';

export interface YouTubeChannelResponse {
  kind: string;
  etag: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: Array<{
    kind: string;
    etag: string;
    id: string;
  }>;
}

export async function getChannelByHandle(
  handle: string,
  apiKey: string,
): Promise<YouTubeChannelResponse | null> {
  try {
    const response = await axios.get<YouTubeChannelResponse>(
      'https://www.googleapis.com/youtube/v3/channels',
      {
        params: {
          part: 'id',
          forHandle: handle.startsWith('@') ? handle : `@${handle}`,
          key: apiKey,
        },
      },
    );

    return response.data;
  } catch (error) {
    await sendExceptionToDiscord(error, {
      handle,
      apiKey: apiKey.substring(0, 10) + '...', // API 키 일부만 로깅
    });
    return null;
  }
}
