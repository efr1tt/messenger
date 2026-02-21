import { client } from '@/shared/api/client';

export async function sendMessage(conversationId: string, text: string) {
  const { data } = await client.post('/messages', {
    conversationId,
    text,
  });

  return data;
}
