export interface CreateYoutubeDto {
  link: string;
  channelName: string;
  channelId: string;
  title?: string;
  snippet?: string;
  publishedAt: string; // ISO date string
  content?: string;
  thumbnail?: string;
  summary?: string;
}

export interface YoutubeEntity {
  link: string;
  channelName: string;
  channelId: string;
  title?: string;
  snippet?: string;
  publishedAt: string; // ISO date string
  content?: string;
  thumbnail?: string;
  createdAt: string; // ISO date string
  summary?: string;
}
