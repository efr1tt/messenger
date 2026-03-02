import { io, Socket } from 'socket.io-client';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3001';
const DEFAULT_SOCKET_PATH = '/api/socket.io';

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

export type CallMediaType = 'audio' | 'video';

export type CallOfferEvent = {
  fromUserId: string;
  conversationId: string;
  offer: RTCSessionDescriptionInit;
  media?: CallMediaType;
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

export type CallUnavailableEvent = {
  toUserId: string;
  conversationId: string;
};

export type CallCameraStateEvent = {
  fromUserId: string;
  conversationId: string;
  enabled: boolean;
};

function getSocketConfig() {
  const fallback = {
    url: API_BASE,
    path: DEFAULT_SOCKET_PATH,
  };

  try {
    const parsed = new URL(API_BASE);
    const normalizedPath = parsed.pathname.endsWith('/')
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;

    return {
      url: parsed.origin,
      path: `${normalizedPath || '/api'}/socket.io`,
    };
  } catch {
    return fallback;
  }
}

export function createChatSocket(accessToken: string): Socket {
  const { url, path } = getSocketConfig();

  return io(url, {
    path,
    auth: {
      token: accessToken,
    },
    transports: ['websocket', 'polling'],
  });
}
