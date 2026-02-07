import OpenAI from 'openai';
import { YoutubeDailySummaryService } from './youtube-daily-summary.service';
import { findAllYoutube } from '../../remotes/web3-scan/youtube';
import { createBlog } from '../../remotes/web3-scan/blog';
import * as fs from 'fs';

jest.mock('openai');
jest.mock('../../remotes/web3-scan/youtube');
jest.mock('../../remotes/web3-scan/blog');
jest.mock('fs');
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockImplementation(() => ({
      generateContent: jest.fn().mockResolvedValue({
        response: {
          text: () => 'Mocked response',
        },
      }),
    })),
  })),
}));

process.env.GEMINI_API_KEY = 'mock-key';
process.env.OPENAI_API_KEY = 'mock-key';

describe('YoutubeDailySummaryService', () => {
  let service: YoutubeDailySummaryService;
  let mockOpenAI: jest.Mocked<OpenAI>;

  beforeEach(() => {
    mockOpenAI = {
      chat: {
        completions: {
          create: jest.fn(),
        },
      },
      files: {
        create: jest.fn(),
        content: jest.fn(),
      },
      batches: {
        create: jest.fn(),
        retrieve: jest.fn(),
      },
    } as any;

    (findAllYoutube as jest.Mock).mockResolvedValue([
      {
        id: 1,
        title: 'Video 1',
        content: 'Transcript 1',
        createdAt: new Date().toISOString(),
      },
      {
        id: 2,
        title: 'Video 2',
        content: 'Transcript 2',
        createdAt: new Date().toISOString(),
      },
    ]);

    service = new YoutubeDailySummaryService(mockOpenAI as any);

    // Mock fs methods to avoid actual file operations
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.readFileSync as jest.Mock).mockReturnValue('[]');
    (fs.writeFileSync as jest.Mock).mockImplementation(() => {});
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1024 });
    (fs.createReadStream as jest.Mock).mockReturnValue({});
  });

  describe('process', () => {
    it('should group contents and create batch jobs', async () => {
      // Mock topic grouping
      (mockOpenAI.chat.completions.create as jest.Mock).mockResolvedValue({
        choices: [
          {
            message: {
              function_call: {
                name: 'group_contents_by_topic',
                arguments: JSON.stringify({
                  groups: [{ topic: 'Topic 1', contentIndices: [0, 1] }],
                }),
              },
            },
          },
        ],
      });

      // Mock file upload and batch creation
      (mockOpenAI.files.create as jest.Mock).mockResolvedValue({
        id: 'file-1',
      });
      (mockOpenAI.batches.create as jest.Mock).mockResolvedValue({
        id: 'batch-1',
      });

      await service.process();

      expect(findAllYoutube).toHaveBeenCalled();
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
      expect(mockOpenAI.batches.create).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should skip if not enough contents', async () => {
      (findAllYoutube as jest.Mock).mockResolvedValue([
        { id: 1, content: 'T1', createdAt: new Date().toISOString() },
      ]);

      await service.process();

      expect(mockOpenAI.chat.completions.create).not.toHaveBeenCalled();
    });
  });

  describe('checkAndProcessBatchJobs', () => {
    it('should handle completed batch jobs and create blogs', async () => {
      // Mock cache with a pending job
      const mockCache = [
        {
          jobId: 'batch-1',
          jobType: 'blog',
          status: 'pending',
          groups: [{ topic: 'Topic 1', contents: [] }],
          createdAt: Date.now(),
        },
      ];
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockCache));
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      // Mock batch retrieval as completed
      (mockOpenAI.batches.retrieve as jest.Mock).mockResolvedValue({
        id: 'batch-1',
        status: 'completed',
        output_file_id: 'output-1',
      });

      // Mock output file content
      (mockOpenAI.files.content as jest.Mock).mockResolvedValue({
        text: async () =>
          JSON.stringify({
            custom_id: 'blog-0',
            response: {
              body: {
                choices: [
                  {
                    message: {
                      function_call: {
                        name: 'generate_daily_blog',
                        arguments: JSON.stringify({
                          title: 'Blog Title',
                          content: 'Blog Content',
                        }),
                      },
                    },
                  },
                ],
              },
            },
          }),
      });

      // Mock Gemini image generation
      jest
        .spyOn(service.geminiImageBatchService, 'hasProcessingBatchJob')
        .mockResolvedValue(null);
      jest
        .spyOn(service.geminiImageBatchService, 'processBatchResults')
        .mockResolvedValue([]);
      jest
        .spyOn(service.geminiImageBatchService, 'generateBatchImages')
        .mockResolvedValue([]);

      await service.checkAndProcessBatchJobs();

      expect(mockOpenAI.batches.retrieve).toHaveBeenCalledWith('batch-1');
      expect(createBlog).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Blog Title',
          content: 'Blog Content',
        }),
      );
    });
  });
});
