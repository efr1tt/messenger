import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AccessPayload, AuthenticatedUser } from '../auth.types';
import { getAccessSecret } from '../jwt.config';

type RequestWithUser = Request & {
  user?: AuthenticatedUser;
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RequestWithUser>();
    const header = req.headers.authorization;
    const token = this.extractBearerToken(header);

    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<AccessPayload>(token, {
        secret: getAccessSecret(),
      });

      if (payload.type !== 'access' || !payload.sub || !payload.email) {
        throw new UnauthorizedException('Invalid access token');
      }

      req.user = {
        id: payload.sub,
        email: payload.email,
      };

      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }

  private extractBearerToken(value?: string) {
    if (!value) {
      return null;
    }

    const [type, token] = value.split(' ');
    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token;
  }
}
