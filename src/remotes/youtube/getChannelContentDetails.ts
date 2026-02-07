import axios from 'axios';
import { sendExceptionToDiscord } from '../discord/sendExceptionToDiscord';

export interface YouTubeChannelContentDetailsResponse {
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
    contentDetails: {
      relatedPlaylists: {
        likes: string;
        uploads: string;
      };
    };
  }>;
}

export async function getChannelContentDetails(
  channelId: string,
  apiKey: string,
): Promise<YouTubeChannelContentDetailsResponse | null> {
  try {
    const response = await axios.get<YouTubeChannelContentDetailsResponse>(
      'https://www.googleapis.com/youtube/v3/channels',
      {
        params: {
          part: 'contentDetails',
          id: channelId,
          key: apiKey,
        },
      },
    );

    return response.data;
  } catch (error) {
    await sendExceptionToDiscord(error, {
      channelId,
      apiKey: apiKey.substring(0, 10) + '...', // API 키 일부만 로깅
    });
    return null;
  }
}

