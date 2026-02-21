import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';

export type MessageNewEvent = {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    senderId: string;
    text: string;
    createdAt: string;
  };
};

export function createChatSocket(accessToken: string): Socket {
  return io(API_BASE, {
    transports: ['websocket'],
    auth: {
      token: accessToken,
    },
  });
}
