import { sendDiscordMessage } from 'src/remotes/discord';

export const sendDevMessage = async (message: string) => {
  sendDiscordMessage(
    message,
    'https://discord.com/api/webhooks/1355914913477955786/A1hhqeaVsdpLf6e21GjFjWvhS9ItacSpeUPbX7a6HaXFh7J1LYofYUA82K7_nttjVk06',
  );
};
