import axios from 'axios';
import { sendExceptionToDiscord } from '../discord/sendExceptionToDiscord';

export interface YouTubePlaylistItemsResponse {
  kind: string;
  etag: string;
  items: Array<{
    kind: string;
    etag: string;
    id: string;
    snippet: {
      publishedAt: string;
      channelId: string;
      title: string;
      description: string;
      thumbnails: {
        default: {
          url: string;
          width: number;
          height: number;
        };
        medium: {
          url: string;
          width: number;
          height: number;
        };
        high: {
          url: string;
          width: number;
          height: number;
        };
        standard: {
          url: string;
          width: number;
          height: number;
        };
        maxres?: {
          url: string;
          width: number;
          height: number;
        };
      };
      channelTitle: string;
      playlistId: string;
      position: number;
      resourceId: {
        kind: string;
        videoId: string;
      };
      videoOwnerChannelTitle: string;
      videoOwnerChannelId: string;
    };
    contentDetails: {
      videoId: string;
      videoPublishedAt: string;
    };
  }>;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
}

export async function getPlaylistItems(
  playlistId: string,
  apiKey: string,
  maxResults = 50,
): Promise<YouTubePlaylistItemsResponse | null> {
  try {
    const response = await axios.get<YouTubePlaylistItemsResponse>(
      'https://www.googleapis.com/youtube/v3/playlistItems',
      {
        params: {
          part: 'snippet,contentDetails',
          playlistId,
          maxResults,
          key: apiKey,
        },
      },
    );

    return response.data;
  } catch (error) {
    await sendExceptionToDiscord(error, {
      playlistId,
      maxResults,
      apiKey: apiKey.substring(0, 10) + '...', // API 키 일부만 로깅
    });
    return null;
  }
}
