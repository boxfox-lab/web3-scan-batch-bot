import axios from 'axios';
import { sendExceptionToDiscord } from '../discord/sendExceptionToDiscord';

export interface YouTubeSearchResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  regionCode: string;
  pageInfo: {
    totalResults: number;
    resultsPerPage: number;
  };
  items: Array<{
    kind: string;
    etag: string;
    id: {
      kind: string;
      videoId: string;
    };
    snippet: {
      publishedAt: string;
      channelId: string;
      title: string;
      description: string;
      thumbnails: {
        default: { url: string; width: number; height: number };
        medium: { url: string; width: number; height: number };
        high: { url: string; width: number; height: number };
      };
      channelTitle: string;
      liveBroadcastContent: string;
      publishTime: string;
    };
  }>;
}

export async function searchVideos(
  query: string,
  apiKey: string,
  maxResults = 10,
): Promise<YouTubeSearchResponse | null> {
  try {
    const response = await axios.get<YouTubeSearchResponse>(
      'https://www.googleapis.com/youtube/v3/search',
      {
        params: {
          part: 'snippet',
          q: query,
          type: 'video',
          order: 'relevance',
          maxResults,
          key: apiKey,
        },
      },
    );

    return response.data;
  } catch (error) {
    await sendExceptionToDiscord(error, {
      query,
      maxResults,
      apiKey: apiKey.substring(0, 10) + '...',
    });
    return null;
  }
}
