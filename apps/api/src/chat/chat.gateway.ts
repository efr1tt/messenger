import {
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Socket, Server } from 'socket.io';
import { AccessPayload } from '../auth/auth.types';
import { getAccessSecret } from '../auth/jwt.config';

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

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtService: JwtService) {}

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
    } catch {
      socket.disconnect();
    }
  }

  handleDisconnect(@ConnectedSocket() _socket: AuthenticatedSocket) {}

  emitMessageNew(userIds: string[], payload: MessageNewPayload) {
    const uniqueUserIds = [...new Set(userIds)];

    uniqueUserIds.forEach((userId) => {
      this.server.to(this.getUserRoom(userId)).emit('message:new', payload);
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
}
