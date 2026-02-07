import { startJob } from './startJob';
import { sleep } from './sleep';
import { GlobalErrorHandler } from './error/global-error-handler';

jest.mock('./sleep', () => ({
  sleep: jest.fn(),
}));

jest.mock('./error/global-error-handler', () => ({
  GlobalErrorHandler: {
    handleError: jest.fn(),
  },
}));

describe('startJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should call task repeatedly and handle errors', async () => {
    const task = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Test failure'))
      .mockRejectedValueOnce(new Error('429 Too Many Requests')); // Should stop here

    // Mock sleep to allow the loop to proceed
    (sleep as jest.Mock).mockResolvedValue(undefined);

    await startJob('Test Bot', task, 100);

    expect(task).toHaveBeenCalledTimes(3);
    expect(GlobalErrorHandler.handleError).toHaveBeenCalledTimes(1); // Only for 'Test failure'
    expect(GlobalErrorHandler.handleError).toHaveBeenCalledWith(
      expect.any(Error),
      'Test Bot',
    );
  });

  it('should stop immediately on 429 error', async () => {
    const task = jest.fn().mockRejectedValue(new Error('429 error occurred'));

    await startJob('Rate Limited Bot', task, 100);

    expect(task).toHaveBeenCalledTimes(1);
    expect(GlobalErrorHandler.handleError).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});
