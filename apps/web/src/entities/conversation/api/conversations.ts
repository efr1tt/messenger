import { client } from '@/shared/api/client';

export type ConversationMessage = {
  id: string;
  conversationId: string;
  text: string;
  senderId: string;
  createdAt: string;
};

export type ConversationItem = {
  id: string;
  isDirect: boolean;
  createdAt: string;
  updatedAt: string;
  members: Array<{
    id: string;
    username: string;
    displayName: string;
    avatarKey?: string | null;
    email: string;
  }>;
  lastMessage: ConversationMessage | null;
  unreadCount: number;
};

export type MessagesPage = {
  items: ConversationMessage[];
  nextCursor: string | null;
};

export async function createDirectConversation(userId: string) {
  const { data } = await client.post('/conversations/direct', { userId });
  return data;
}

export async function getConversations() {
  const { data } = await client.get<ConversationItem[]>('/conversations');
  return data;
}

export async function getConversationMessages(
  conversationId: string,
  cursor?: string,
  limit = 20,
) {
  const { data } = await client.get<MessagesPage>(`/conversations/${conversationId}/messages`, {
    params: {
      cursor,
      limit,
    },
  });

  return data;
}

export async function markConversationRead(conversationId: string) {
  const { data } = await client.post<{ success: boolean; conversationId: string }>(
    `/conversations/${conversationId}/read`,
  );
  return data;
}
