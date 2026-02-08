import OpenAI from 'openai';
import { Web3ScanService } from './web3-scan.service';
import { getSubtitles } from 'youtube-caption-extractor';
import { createYoutube, findAllYoutube } from '../../remotes/web3-scan/youtube';
import {
  getChannelByHandle,
  getChannelContentDetails,
  getPlaylistItems,
} from '../../remotes/youtube';
import { GlobalErrorHandler } from '../../util/error/global-error-handler';

jest.mock('openai');
jest.mock('youtube-caption-extractor');
jest.mock('../../remotes/web3-scan/youtube');
jest.mock('../../remotes/youtube');
jest.mock('../../util/error/global-error-handler');

describe('Web3ScanService', () => {
  let service: Web3ScanService;
  let mockOpenAI: any;

  // 테스트 데이터 상수
  const MOCK_CHANNEL_ID = 'channel123';
  const MOCK_PLAYLIST_ID = 'playlist123';
  const MOCK_VIDEO_ID = 'video123';
  const MOCK_CHANNEL_HANDLE = '@JoshuaDeuk';
  const MOCK_VIDEO_TITLE = 'Test Video Title';
  const MOCK_CHANNEL_NAME = 'Test Channel';
  const MOCK_PUBLISHED_AT = '2026-02-06T00:00:00Z';
  const MOCK_THUMBNAIL_URL = 'https://example.com/thumb.jpg';

  const createMockChannelResponse = (channelId: string) => ({
    items: [{ id: channelId }],
  });

  const createMockContentDetailsResponse = (playlistId: string) => ({
    items: [
      {
        contentDetails: {
          relatedPlaylists: {
            uploads: playlistId,
          },
        },
      },
    ],
  });

  const createMockPlaylistItemsResponse = (
    videoId: string,
    title: string = MOCK_VIDEO_TITLE,
  ) => ({
    items: [
      {
        contentDetails: {
          videoId,
          videoPublishedAt: MOCK_PUBLISHED_AT,
        },
        snippet: {
          title,
          description: 'Test Description',
          channelTitle: MOCK_CHANNEL_NAME,
          thumbnails: {
            high: { url: MOCK_THUMBNAIL_URL },
          },
        },
      },
    ],
    pageInfo: { totalResults: 1 },
  });

  const createMockCaptions = (text: string) => [{ text }];

  const createMockGPTResponse = (
    functionName: string,
    args: { title: string; content: string; shortSummary: string },
  ) => ({
    choices: [
      {
        message: {
          function_call: {
            name: functionName,
            arguments: JSON.stringify(args),
          },
        },
      },
    ],
  });

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
    process.env.YOUTUBE_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('process', () => {
    describe('성공 케이스', () => {
      it('유튜브 채널을 처리하고 한국어 콘텐츠를 생성해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('한국어 자막 텍스트'),
        );

        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'AI 생성 제목',
              content: 'AI 생성 콘텐츠',
              shortSummary: '요약',
            }),
          )
          .mockResolvedValueOnce(
            createMockGPTResponse('translate_to_english', {
              title: 'Translated Title',
              content: 'Translated Content',
              shortSummary: 'Translated Summary',
            }),
          );

        // Act
        await service.process();

        // Assert
        expect(getChannelByHandle).toHaveBeenCalledWith(
          MOCK_CHANNEL_HANDLE,
          'test-api-key',
        );
        expect(getChannelContentDetails).toHaveBeenCalledWith(
          MOCK_CHANNEL_ID,
          'test-api-key',
        );
        expect(getPlaylistItems).toHaveBeenCalledWith(
          MOCK_PLAYLIST_ID,
          'test-api-key',
          10,
        );
        expect(findAllYoutube).toHaveBeenCalledWith(MOCK_CHANNEL_ID);
        expect(getSubtitles).toHaveBeenCalledWith({
          videoID: MOCK_VIDEO_ID,
          lang: 'ko',
        });
        expect(createYoutube).toHaveBeenCalledTimes(2); // 한국어 + 영어 번역
      });

      it('영어 자막만 있을 때 영어 콘텐츠를 생성하고 한국어로 번역해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock)
          .mockResolvedValueOnce([]) // 한국어 자막 없음
          .mockResolvedValueOnce(createMockCaptions('English caption text'));

        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'English Title',
              content: 'English Content',
              shortSummary: 'Summary',
            }),
          )
          .mockResolvedValueOnce(
            createMockGPTResponse('translate_to_korean', {
              title: '번역된 제목',
              content: '번역된 콘텐츠',
              shortSummary: '번역된 요약',
            }),
          );

        // Act
        await service.process();

        // Assert
        expect(getSubtitles).toHaveBeenCalledTimes(2);
        expect(getSubtitles).toHaveBeenCalledWith({
          videoID: MOCK_VIDEO_ID,
          lang: 'ko',
        });
        expect(getSubtitles).toHaveBeenCalledWith({
          videoID: MOCK_VIDEO_ID,
          lang: 'en',
        });
        expect(createYoutube).toHaveBeenCalledTimes(2);
      });

      it('이미 등록된 영상은 건너뛰어야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([
          { link: `https://www.youtube.com/watch?v=${MOCK_VIDEO_ID}` },
        ]);

        // Act
        await service.process();

        // Assert
        expect(getSubtitles).not.toHaveBeenCalled();
        expect(createYoutube).not.toHaveBeenCalled();
      });

      it('여러 영상 중 일부만 등록되어 있을 때 미등록 영상만 처리해야 한다', async () => {
        // Arrange
        const registeredVideoId = 'registered123';
        const newVideoId = 'new123';

        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue({
          items: [
            {
              contentDetails: {
                videoId: registeredVideoId,
                videoPublishedAt: MOCK_PUBLISHED_AT,
              },
              snippet: {
                title: 'Registered Video',
                description: 'Desc',
                channelTitle: MOCK_CHANNEL_NAME,
                thumbnails: { high: { url: MOCK_THUMBNAIL_URL } },
              },
            },
            {
              contentDetails: {
                videoId: newVideoId,
                videoPublishedAt: MOCK_PUBLISHED_AT,
              },
              snippet: {
                title: 'New Video',
                description: 'Desc',
                channelTitle: MOCK_CHANNEL_NAME,
                thumbnails: { high: { url: MOCK_THUMBNAIL_URL } },
              },
            },
          ],
          pageInfo: { totalResults: 2 },
        });
        (findAllYoutube as jest.Mock).mockResolvedValue([
          { link: `https://www.youtube.com/watch?v=${registeredVideoId}` },
        ]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption text'),
        );
        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'AI Title',
              content: 'AI Content',
              shortSummary: 'Summary',
            }),
          )
          .mockResolvedValueOnce(
            createMockGPTResponse('translate_to_english', {
              title: 'Translated',
              content: 'Translated',
              shortSummary: 'Translated',
            }),
          );

        // Act
        await service.process();

        // Assert
        expect(getSubtitles).toHaveBeenCalledTimes(1);
        expect(getSubtitles).toHaveBeenCalledWith({
          videoID: newVideoId,
          lang: 'ko',
        });
      });

      it('삭선 마크다운(~~)을 제거하고 콘텐츠를 저장해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption'),
        );

        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'Title',
              content: 'Content with ~~strikethrough~~ text',
              shortSummary: 'Summary',
            }),
          )
          .mockResolvedValueOnce(
            createMockGPTResponse('translate_to_english', {
              title: 'Title',
              content: 'Translated ~~strikethrough~~ content',
              shortSummary: 'Summary',
            }),
          );

        // Act
        await service.process();

        // Assert
        const createCalls = (createYoutube as jest.Mock).mock.calls;
        expect(createCalls[0][0].content).toBe('Content with strikethrough text');
        expect(createCalls[1][0].content).toBe(
          'Translated strikethrough content',
        );
      });
    });

    describe('에러 케이스', () => {
      it('YOUTUBE_API_KEY가 없으면 조기 종료해야 한다', async () => {
        // Arrange
        delete process.env.YOUTUBE_API_KEY;

        // Act
        await service.process();

        // Assert
        expect(getChannelByHandle).not.toHaveBeenCalled();
      });

      it('채널을 찾을 수 없으면 다음 채널로 계속 진행해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue({ items: [] });

        // Act
        await service.process();

        // Assert
        expect(getChannelContentDetails).not.toHaveBeenCalled();
        expect(GlobalErrorHandler.handleError).not.toHaveBeenCalled();
      });

      it('플레이리스트를 찾을 수 없으면 다음 채널로 계속 진행해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue({ items: [] });

        // Act
        await service.process();

        // Assert
        expect(getPlaylistItems).not.toHaveBeenCalled();
      });

      it('플레이리스트에 영상이 없으면 다음 채널로 계속 진행해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue({ items: [] });

        // Act
        await service.process();

        // Assert
        expect(findAllYoutube).not.toHaveBeenCalled();
      });

      it('등록된 영상 목록 조회 실패(429)시 경고하고 계속 진행해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockRejectedValue(
          new Error('429 Rate limit exceeded'),
        );
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption'),
        );
        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'Title',
              content: 'Content',
              shortSummary: 'Summary',
            }),
          )
          .mockResolvedValueOnce(
            createMockGPTResponse('translate_to_english', {
              title: 'Title',
              content: 'Content',
              shortSummary: 'Summary',
            }),
          );

        // Act
        await service.process();

        // Assert
        expect(getSubtitles).toHaveBeenCalled();
        expect(GlobalErrorHandler.handleError).not.toHaveBeenCalled();
      });

      it('자막을 가져올 수 없으면 해당 영상을 건너뛰어야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock)
          .mockResolvedValueOnce([]) // 한국어 없음
          .mockResolvedValueOnce([]); // 영어도 없음

        // Act
        await service.process();

        // Assert
        expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
        expect(createYoutube).not.toHaveBeenCalled();
      });

      it('GPT 콘텐츠 생성 실패 시 에러를 처리하고 건너뛰어야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption'),
        );
        mockOpenAI.chat.completions.create.mockRejectedValue(
          new Error('OpenAI API error'),
        );

        // Act
        await service.process();

        // Assert
        expect(GlobalErrorHandler.handleError).toHaveBeenCalledWith(
          expect.any(Error),
          'Web3ScanService.generateContentFromCaption',
          expect.any(Object),
        );
        expect(createYoutube).not.toHaveBeenCalled();
      });

      it('GPT function call이 없으면 null을 반환하고 건너뛰어야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption'),
        );
        mockOpenAI.chat.completions.create.mockResolvedValue({
          choices: [{ message: {} }],
        });

        // Act
        await service.process();

        // Assert
        expect(createYoutube).not.toHaveBeenCalled();
      });

      it('번역 실패 시 원본 언어 콘텐츠만 저장해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption'),
        );
        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'Title',
              content: 'Content',
              shortSummary: 'Summary',
            }),
          )
          .mockRejectedValueOnce(new Error('Translation failed'));

        // Act
        await service.process();

        // Assert
        expect(createYoutube).toHaveBeenCalledTimes(1); // 원본만
        expect(GlobalErrorHandler.handleError).toHaveBeenCalledWith(
          expect.any(Error),
          'Web3ScanService.translateContent',
          expect.any(Object),
        );
      });

      it('채널 처리 중 에러 발생 시 GlobalErrorHandler를 호출하고 다음 채널로 진행해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockRejectedValue(
          new Error('Network error'),
        );

        // Act
        await service.process();

        // Assert
        expect(GlobalErrorHandler.handleError).toHaveBeenCalledWith(
          expect.any(Error),
          'Web3ScanService',
          expect.objectContaining({ handle: MOCK_CHANNEL_HANDLE }),
        );
      });
    });

    describe('경계값 테스트', () => {
      it('빈 자막 배열을 받으면 다음 언어로 시도해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock)
          .mockResolvedValueOnce([]) // 한국어 빈 배열
          .mockResolvedValueOnce(createMockCaptions('English caption'));
        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'Title',
              content: 'Content',
              shortSummary: 'Summary',
            }),
          )
          .mockResolvedValueOnce(
            createMockGPTResponse('translate_to_korean', {
              title: '제목',
              content: '콘텐츠',
              shortSummary: '요약',
            }),
          );

        // Act
        await service.process();

        // Assert
        expect(getSubtitles).toHaveBeenCalledTimes(2);
      });

      it('썸네일이 없는 영상도 정상 처리해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue({
          items: [
            {
              contentDetails: {
                videoId: MOCK_VIDEO_ID,
                videoPublishedAt: MOCK_PUBLISHED_AT,
              },
              snippet: {
                title: MOCK_VIDEO_TITLE,
                description: 'Desc',
                channelTitle: MOCK_CHANNEL_NAME,
                thumbnails: {}, // 썸네일 없음
              },
            },
          ],
          pageInfo: { totalResults: 1 },
        });
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption'),
        );
        mockOpenAI.chat.completions.create
          .mockResolvedValueOnce(
            createMockGPTResponse('generate_youtube_content', {
              title: 'Title',
              content: 'Content',
              shortSummary: 'Summary',
            }),
          )
          .mockResolvedValueOnce(
            createMockGPTResponse('translate_to_english', {
              title: 'Title',
              content: 'Content',
              shortSummary: 'Summary',
            }),
          );

        // Act
        await service.process();

        // Assert
        const createCalls = (createYoutube as jest.Mock).mock.calls;
        expect(createCalls[0][0].thumbnail).toBeUndefined();
      });

      it('GPT 응답에서 빈 문자열 필드도 처리해야 한다', async () => {
        // Arrange
        (getChannelByHandle as jest.Mock).mockResolvedValue(
          createMockChannelResponse(MOCK_CHANNEL_ID),
        );
        (getChannelContentDetails as jest.Mock).mockResolvedValue(
          createMockContentDetailsResponse(MOCK_PLAYLIST_ID),
        );
        (getPlaylistItems as jest.Mock).mockResolvedValue(
          createMockPlaylistItemsResponse(MOCK_VIDEO_ID),
        );
        (findAllYoutube as jest.Mock).mockResolvedValue([]);
        (getSubtitles as jest.Mock).mockResolvedValue(
          createMockCaptions('caption'),
        );
        mockOpenAI.chat.completions.create.mockResolvedValue(
          createMockGPTResponse('generate_youtube_content', {
            title: '',
            content: '',
            shortSummary: '',
          }),
        );

        // Act
        await service.process();

        // Assert
        const createCalls = (createYoutube as jest.Mock).mock.calls;
        expect(createCalls[0][0].title).toBe('');
        expect(createCalls[0][0].content).toBe('');
        expect(createCalls[0][0].summary).toBe('');
      });
    });
  });
});
