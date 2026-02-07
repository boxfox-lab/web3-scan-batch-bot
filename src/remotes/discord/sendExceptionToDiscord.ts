import { sendDiscordMessage } from './sendDiscordMessage';

const COMPOUNDING_BOT_WEBHOOK_URL =
  'https://discord.com/api/webhooks/1396402912409682024/_pAEeOyMoBydKndxL5DPbJ5HiFdU52IyHHFplQO-5tKNRtZyyGJzYuMSBvIMZr3G20vK';

interface ExceptionContext {
  [key: string]: any;
}

export async function sendExceptionToDiscord(
  error: any,
  context?: ExceptionContext,
) {
  try {
    // 에러 정보 추출
    let errorMessage = '알 수 없는 에러';
    let errorName = 'Unknown';
    let errorStack = '';

    if (error instanceof Error) {
      errorMessage = error.message || '메시지 없음';
      errorName = error.name || 'Unknown';
      errorStack = error.stack || '';
    } else if (typeof error === 'string') {
      errorMessage = error;
      errorName = 'String Error';
    } else if (typeof error === 'object' && error !== null) {
      errorMessage = error.message || error.msg || JSON.stringify(error);
      errorName = error.name || error.type || 'Object Error';
      errorStack = error.stack || '';
    } else {
      errorMessage = String(error);
      errorName = typeof error;
    }

    // context 문자열화
    let contextStr = '';
    if (context && Object.keys(context).length > 0) {
      contextStr = '\n[context]\n' + JSON.stringify(context, null, 2);
    }

    // content 필드에 요약 정보
    const content = `🚨 에러 발생\n[타입] ${errorName}\n[메시지] ${errorMessage}${contextStr}`;
    await sendDiscordMessage(content, COMPOUNDING_BOT_WEBHOOK_URL);

    // 스택 트레이스가 있으면 1024자 이하로 쪼개서 여러 번 전송 (줄 단위로 끊김 방지)
    if (errorStack && errorStack.length > 0) {
      const MAX = 1024;
      const lines = errorStack.split('\n');
      let chunk = '';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // 한 줄이 MAX를 넘는 경우, 그 줄만 여러 메시지로 쪼갬
        if (line.length > MAX) {
          // 먼저 현재 chunk를 보내고 초기화
          if (chunk.length > 0) {
            await sendDiscordMessage(
              `\`\`\`\n${chunk}\n\`\`\``,
              COMPOUNDING_BOT_WEBHOOK_URL,
            );
            chunk = '';
          }
          // 긴 줄을 MAX 단위로 쪼개서 전송
          for (let j = 0; j < line.length; j += MAX) {
            const longLineChunk = line.slice(j, j + MAX);
            await sendDiscordMessage(
              `\`\`\`\n${longLineChunk}\n\`\`\``,
              COMPOUNDING_BOT_WEBHOOK_URL,
            );
          }
          continue;
        }
        // chunk에 줄 추가 (\n 포함)
        if ((chunk + line + '\n').length > MAX) {
          // chunk가 MAX를 넘으면 전송 후 초기화
          await sendDiscordMessage(
            `\`\`\`\n${chunk}\n\`\`\``,
            COMPOUNDING_BOT_WEBHOOK_URL,
          );
          chunk = '';
        }
        chunk += line + '\n';
      }
      // 남은 chunk 전송
      if (chunk.length > 0) {
        await sendDiscordMessage(
          `\`\`\`\n${chunk}\n\`\`\``,
          COMPOUNDING_BOT_WEBHOOK_URL,
        );
      }
    }
  } catch (e) {
    console.error(e);
  }
}
