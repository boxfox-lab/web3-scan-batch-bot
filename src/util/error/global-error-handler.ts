import { sendDevMessage } from 'src/remotes/discord';

interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
  timestamp: string;
  jobName?: string;
  additionalInfo?: any;
}

export class GlobalErrorHandler {
  private static formatError(
    error: Error,
    jobName?: string,
    additionalInfo?: any,
  ): ErrorInfo {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
      jobName,
      additionalInfo,
    };
  }

  private static formatDiscordMessage(errorInfo: ErrorInfo): string {
    const { name, message, stack, timestamp, jobName, additionalInfo } =
      errorInfo;

    let discordMessage = `🚨 **예외 발생**\n\n`;
    discordMessage += `**시간:** ${timestamp}\n`;

    if (jobName) {
      discordMessage += `**작업:** ${jobName}\n`;
    }

    discordMessage += `**예외 타입:** ${name}\n`;
    discordMessage += `**메시지:** ${message}\n`;

    if (additionalInfo) {
      discordMessage += `**추가 정보:** ${JSON.stringify(
        additionalInfo,
        null,
        2,
      )}\n`;
    }

    if (stack) {
      // 스택 트레이스를 줄여서 Discord 메시지 제한에 맞춤
      const stackLines = stack.split('\n').slice(0, 10);
      discordMessage += `**스택 트레이스:**\n\`\`\`\n${stackLines.join(
        '\n',
      )}\n\`\`\``;
    }

    return discordMessage;
  }

  static async handleError(
    error: Error,
    jobName?: string,
    additionalInfo?: any,
  ): Promise<void> {
    // 콘솔에 에러 출력
    const errorInfo = this.formatError(error, jobName, additionalInfo);
    console.error('🚨 예외 발생:', {
      jobName: errorInfo.jobName,
      name: errorInfo.name,
      message: errorInfo.message,
      timestamp: errorInfo.timestamp,
      additionalInfo: errorInfo.additionalInfo,
    });
    if (errorInfo.stack) {
      console.error('스택 트레이스:', errorInfo.stack);
    }

    try {
      const discordMessage = this.formatDiscordMessage(errorInfo);
      await sendDevMessage(discordMessage);
    } catch (discordError) {
      // Discord 전송 실패 시 콘솔에 출력
      console.error('Discord로 예외 전송 실패:', discordError);
    }
  }

  static wrapAsyncFunction<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    jobName?: string,
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        await this.handleError(error as Error, jobName, { args });
        throw error; // 원본 예외를 다시 던져서 호출자가 처리할 수 있도록 함
      }
    };
  }

  static wrapSyncFunction<T extends any[], R>(
    fn: (...args: T) => R,
    jobName?: string,
  ): (...args: T) => R {
    return (...args: T): R => {
      try {
        return fn(...args);
      } catch (error) {
        this.handleError(error as Error, jobName, { args });
        throw error;
      }
    };
  }
}
