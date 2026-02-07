import { GlobalErrorHandler } from './global-error-handler';
import { sendDevMessage } from 'src/remotes/discord';

jest.mock('src/remotes/discord', () => ({
  sendDevMessage: jest.fn(),
}));

describe('GlobalErrorHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handleError', () => {
    it('should format error and send to discord', async () => {
      const error = new Error('Test error');
      const jobName = 'Test Job';

      await GlobalErrorHandler.handleError(error, jobName);

      expect(sendDevMessage).toHaveBeenCalledWith(
        expect.stringContaining('🚨 **예외 발생**'),
      );
      expect(sendDevMessage).toHaveBeenCalledWith(
        expect.stringContaining('**작업:** Test Job'),
      );
      expect(sendDevMessage).toHaveBeenCalledWith(
        expect.stringContaining('**메시지:** Test error'),
      );
    });

    it('should handle discord send failure gracefully', async () => {
      (sendDevMessage as jest.Mock).mockRejectedValueOnce(
        new Error('Discord failure'),
      );
      const error = new Error('Test error');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await expect(
        GlobalErrorHandler.handleError(error),
      ).resolves.not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith(
        'Discord로 예외 전송 실패:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
    });
  });

  describe('wrapAsyncFunction', () => {
    it('should wrap async function and handle errors', async () => {
      const mockFn = jest.fn().mockRejectedValue(new Error('Async error'));
      const wrappedFn = GlobalErrorHandler.wrapAsyncFunction(
        mockFn,
        'WrappedJob',
      );

      await expect(wrappedFn('arg1')).rejects.toThrow('Async error');
      expect(sendDevMessage).toHaveBeenCalledWith(
        expect.stringContaining('**작업:** WrappedJob'),
      );
      expect(sendDevMessage).toHaveBeenCalledWith(
        expect.stringContaining('**추가 정보:**'),
      );
    });

    it('should return result if no error', async () => {
      const mockFn = jest.fn().mockResolvedValue('success');
      const wrappedFn = GlobalErrorHandler.wrapAsyncFunction(mockFn);

      const result = await wrappedFn();
      expect(result).toBe('success');
      expect(sendDevMessage).not.toHaveBeenCalled();
    });
  });
});
