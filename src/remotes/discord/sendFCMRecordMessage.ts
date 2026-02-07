import { sendDiscordMessage } from 'src/remotes/discord';

export const sendFCMRecordMessage = async (message: string) => {
  sendDiscordMessage(
    message,
    'https://discord.com/api/webhooks/1431975808934740000/7k8sTLUpvHvduUTJskJ2TYmefXle79_kBZS7elKnxqIFLCci_for-voUHWIrIchQFUR_',
  );
};
