export function sendDiscordMessage(
  payload: string | object,
  webhookUrl: string,
) {
  if (process.env.NODE_ENV === 'test') {
    return Promise.resolve();
  }
  const data = typeof payload === 'string' ? { content: payload } : payload;

  return new Promise<void>((resolve, reject) => {
    fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
      .then((response) => {
        if (!response.ok) {
          reject(new Error(`Could not send message: ${response.status}`));
        }
        resolve();
      })
      .catch((error) => {
        console.error(error);
        reject(error);
      });
  });
}
