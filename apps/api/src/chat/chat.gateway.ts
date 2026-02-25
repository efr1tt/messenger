import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Socket, Server } from 'socket.io';
import { AccessPayload } from '../auth/auth.types';
import { getAccessSecret } from '../auth/jwt.config';
import { RedisService } from '../redis/redis.service';

type AuthenticatedSocket = Socket & {
  data: {
    userId?: string;
  };
};

export type MessageNewPayload = {
  conversationId: string;
  message: {
    id: string;
    conversationId: string;
    senderId: string;
    text: string;
    createdAt: Date;
  };
};

type CallOfferPayload = {
  toUserId: string;
  conversationId: string;
  offer: Record<string, unknown>;
  media?: 'audio' | 'video';
};

type CallAnswerPayload = {
  toUserId: string;
  conversationId: string;
  answer: Record<string, unknown>;
};

type CallIcePayload = {
  toUserId: string;
  conversationId: string;
  candidate: Record<string, unknown>;
};

type CallEndPayload = {
  toUserId: string;
  conversationId: string;
};

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
  ) {}

  async afterInit() {
    await this.clearOnlinePresenceKeys();
  }

  async handleConnection(@ConnectedSocket() socket: AuthenticatedSocket) {
    const token = this.extractToken(socket);
    if (!token) {
      socket.disconnect();
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessPayload>(token, {
        secret: getAccessSecret(),
      });

      if (payload.type !== 'access' || !payload.sub) {
        socket.disconnect();
        return;
      }

      socket.data.userId = payload.sub;
      socket.join(this.getUserRoom(payload.sub));
      await this.trackOnline(payload.sub, socket.id);
    } catch {
      socket.disconnect();
    }
  }

  async handleDisconnect(@ConnectedSocket() socket: AuthenticatedSocket) {
    if (!socket.data.userId) {
      return;
    }

    await this.trackOffline(socket.data.userId, socket.id);
  }

  emitMessageNew(userIds: string[], payload: MessageNewPayload) {
    const uniqueUserIds = [...new Set(userIds)];

    uniqueUserIds.forEach((userId) => {
      this.server.to(this.getUserRoom(userId)).emit('message:new', payload);
    });
  }

  @SubscribeMessage('call:offer')
  handleCallOffer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallOfferPayload,
  ) {
    if (
      !socket.data.userId ||
      !payload?.toUserId ||
      !payload?.conversationId ||
      !payload?.offer
    ) {
      return;
    }

    if (payload.toUserId === socket.data.userId) {
      return;
    }

    const recipientRoom = this.getUserRoom(payload.toUserId);
    if (!this.isRoomOnline(recipientRoom)) {
      socket.emit('call:unavailable', {
        toUserId: payload.toUserId,
        conversationId: payload.conversationId,
      });
      return;
    }

    this.server.to(recipientRoom).emit('call:offer', {
      fromUserId: socket.data.userId,
      conversationId: payload.conversationId,
      offer: payload.offer,
      media: payload.media === 'video' ? 'video' : 'audio',
    });
  }

  @SubscribeMessage('call:answer')
  handleCallAnswer(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallAnswerPayload,
  ) {
    if (
      !socket.data.userId ||
      !payload?.toUserId ||
      !payload?.conversationId ||
      !payload?.answer
    ) {
      return;
    }

    this.server.to(this.getUserRoom(payload.toUserId)).emit('call:answer', {
      fromUserId: socket.data.userId,
      conversationId: payload.conversationId,
      answer: payload.answer,
    });
  }

  @SubscribeMessage('call:ice')
  handleCallIce(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallIcePayload,
  ) {
    if (
      !socket.data.userId ||
      !payload?.toUserId ||
      !payload?.conversationId ||
      !payload?.candidate
    ) {
      return;
    }

    this.server.to(this.getUserRoom(payload.toUserId)).emit('call:ice', {
      fromUserId: socket.data.userId,
      conversationId: payload.conversationId,
      candidate: payload.candidate,
    });
  }

  @SubscribeMessage('call:end')
  handleCallEnd(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallEndPayload,
  ) {
    if (!socket.data.userId || !payload?.toUserId || !payload?.conversationId) {
      return;
    }

    this.server.to(this.getUserRoom(payload.toUserId)).emit('call:end', {
      fromUserId: socket.data.userId,
      conversationId: payload.conversationId,
    });
  }

  @SubscribeMessage('call:reject')
  handleCallReject(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: CallEndPayload,
  ) {
    if (!socket.data.userId || !payload?.toUserId || !payload?.conversationId) {
      return;
    }

    this.server.to(this.getUserRoom(payload.toUserId)).emit('call:reject', {
      fromUserId: socket.data.userId,
      conversationId: payload.conversationId,
    });
  }

  private extractToken(socket: AuthenticatedSocket) {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }

    const header = socket.handshake.headers.authorization;
    if (!header || Array.isArray(header)) {
      return null;
    }

    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }

  private getUserRoom(userId: string) {
    return `user:${userId}`;
  }

  private async trackOnline(userId: string, socketId: string) {
    const redis = this.redisService.getClient();
    const key = this.getOnlineKey(userId);

    await this.redisService.ensureConnected();
    await this.purgeStaleSockets(key);
    await redis.sadd(key, socketId);
    const count = await redis.scard(key);

    if (count === 1) {
      this.server.emit('presence:online', { userId });
    }
  }

  private async trackOffline(userId: string, socketId: string) {
    const redis = this.redisService.getClient();
    const key = this.getOnlineKey(userId);

    await this.redisService.ensureConnected();
    await this.purgeStaleSockets(key);
    await redis.srem(key, socketId);
    const count = await redis.scard(key);

    if (count === 0) {
      this.server.emit('presence:offline', { userId });
    }
  }

  private getOnlineKey(userId: string) {
    return `online:user:${userId}`;
  }

  private async purgeStaleSockets(redisKey: string) {
    const redis = this.redisService.getClient();
    const socketIds = await redis.smembers(redisKey);

    if (!socketIds.length) {
      return;
    }

    const staleSocketIds = socketIds.filter(
      (socketId) => !this.server.sockets.sockets.has(socketId),
    );

    if (staleSocketIds.length > 0) {
      await redis.srem(redisKey, ...staleSocketIds);
    }
  }

  private isRoomOnline(room: string) {
    const roomState = this.server.sockets.adapter.rooms.get(room);
    return Boolean(roomState && roomState.size > 0);
  }

  private async clearOnlinePresenceKeys() {
    await this.redisService.ensureConnected();
    const redis = this.redisService.getClient();
    let cursor = '0';

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        'online:user:*',
        'COUNT',
        200,
      );

      if (keys.length > 0) {
        await redis.del(...keys);
      }

      cursor = nextCursor;
    } while (cursor !== '0');
  }
}
