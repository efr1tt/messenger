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

export type PresenceEvent = {
  userId: string;
};

export type CallOfferEvent = {
  fromUserId: string;
  conversationId: string;
  offer: RTCSessionDescriptionInit;
};

export type CallAnswerEvent = {
  fromUserId: string;
  conversationId: string;
  answer: RTCSessionDescriptionInit;
};

export type CallIceEvent = {
  fromUserId: string;
  conversationId: string;
  candidate: RTCIceCandidateInit;
};

export type CallEndEvent = {
  fromUserId: string;
  conversationId: string;
};

export function createChatSocket(accessToken: string): Socket {
  return io(API_BASE, {
    auth: {
      token: accessToken,
    },
  });
}
