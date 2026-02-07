import OpenAI from 'openai';
import { Web3ScanService } from './web3-scan.service';
import { getSubtitles } from 'youtube-caption-extractor';
import { createYoutube, findAllYoutube } from '../../remotes/web3-scan/youtube';
import {
  getChannelByHandle,
  getChannelContentDetails,
  getPlaylistItems,
} from '../../remotes/youtube';

jest.mock('openai');
jest.mock('youtube-caption-extractor');
jest.mock('../../remotes/web3-scan/youtube');
jest.mock('../../remotes/youtube');

describe('Web3ScanService', () => {
  let service: Web3ScanService;
  let mockOpenAI: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
    };

    service = new Web3ScanService(mockOpenAI);
    process.env.YOUTUBE_API_KEY = 'mock-key';
  });

  describe('process', () => {
    it('should process youtube channels and create content', async () => {
      (getChannelByHandle as jest.Mock).mockResolvedValue({
        items: [{ id: 'channel1' }],
      });
      (getChannelContentDetails as jest.Mock).mockResolvedValue({
        items: [
          { contentDetails: { relatedPlaylists: { uploads: 'playlist1' } } },
        ],
      });
      (getPlaylistItems as jest.Mock).mockResolvedValue({
        items: [
          {
            contentDetails: {
              videoId: 'video1',
              videoPublishedAt: '2026-02-06T00:00:00Z',
            },
            snippet: {
              title: 'Video 1',
              description: 'Desc',
              channelTitle: 'Channel 1',
              thumbnails: { high: { url: 'thumb' } },
            },
          },
        ],
        pageInfo: { totalResults: 1 },
      });
      (findAllYoutube as jest.Mock).mockResolvedValue([]);
      (getSubtitles as jest.Mock).mockResolvedValue([{ text: 'caption text' }]);

      mockOpenAI.chat.completions.create.mockResolvedValue({
        choices: [
          {
            message: {
              function_call: {
                name: 'generate_youtube_content',
                arguments: JSON.stringify({
                  title: 'AI Title',
                  content: 'AI Content',
                  shortSummary: 'Summary',
                }),
              },
            },
          },
        ],
      });

      // Mock translateContent call
      mockOpenAI.chat.completions.create
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                function_call: {
                  name: 'generate_youtube_content',
                  arguments: JSON.stringify({
                    title: 'AI Title',
                    content: 'AI Content',
                    shortSummary: 'Summary',
                  }),
                },
              },
            },
          ],
        })
        .mockResolvedValueOnce({
          choices: [
            {
              message: {
                function_call: {
                  name: 'translate_to_english',
                  arguments: JSON.stringify({
                    title: 'Translated Title',
                    content: 'Translated Content',
                    shortSummary: 'Translated Summary',
                  }),
                },
              },
            },
          ],
        });

      await service.process();

      expect(getChannelByHandle).toHaveBeenCalled();
      expect(createYoutube).toHaveBeenCalled();
    });

    it('should skip already registered videos', async () => {
      (getChannelByHandle as jest.Mock).mockResolvedValue({
        items: [{ id: 'c1' }],
      });
      (getChannelContentDetails as jest.Mock).mockResolvedValue({
        items: [{ contentDetails: { relatedPlaylists: { uploads: 'p1' } } }],
      });
      (getPlaylistItems as jest.Mock).mockResolvedValue({
        items: [
          {
            contentDetails: { videoId: 'video1' },
            snippet: { title: 'V1' },
          },
        ],
        pageInfo: { totalResults: 1 },
      });
      (findAllYoutube as jest.Mock).mockResolvedValue([
        { link: 'https://www.youtube.com/watch?v=video1' },
      ]);

      await service.process();

      expect(getSubtitles).not.toHaveBeenCalled();
      expect(createYoutube).not.toHaveBeenCalled();
    });
  });
});
