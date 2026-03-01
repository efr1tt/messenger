import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthTokens, RefreshPayload } from './auth.types';
import { getAccessSecret, getRefreshSecret } from './jwt.config';
import { SmtpMailerService } from './smtp-mailer.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly smtpMailerService: SmtpMailerService,
  ) {}

  async register(dto: RegisterDto, userAgent?: string, ipAddress?: string) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();
    const displayName = dto.displayName.trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });

    if (existing) {
      throw new BadRequestException('Email is already in use');
    }

    const existingUsername = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });

    if (existingUsername) {
      throw new BadRequestException('Username is already in use');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        username,
        displayName,
        email,
        passwordHash,
      },
    });

    const tokens = await this.createSessionAndTokens(
      user,
      userAgent,
      ipAddress,
    );

    return {
      user: this.toPublicUser(user),
      ...tokens,
    };
  }

  async login(dto: LoginDto, userAgent?: string, ipAddress?: string) {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.createSessionAndTokens(
      user,
      userAgent,
      ipAddress,
    );

    return {
      user: this.toPublicUser(user),
      ...tokens,
    };
  }

  async refresh(refreshToken: string, userAgent?: string, ipAddress?: string) {
    const payload = await this.verifyRefreshToken(refreshToken);

    const session = await this.prisma.session.findUnique({
      where: { id: payload.sid },
    });

    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Session revoked');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired');
    }

    const tokenMatch = await bcrypt.compare(
      refreshToken,
      session.refreshTokenHash,
    );
    if (!tokenMatch) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.createSessionAndTokens(
      user,
      userAgent,
      ipAddress,
    );

    return {
      user: this.toPublicUser(user),
      ...tokens,
    };
  }

  async logout(refreshToken: string) {
    const payload = await this.verifyRefreshToken(refreshToken, true);

    await this.prisma.session.updateMany({
      where: {
        id: payload.sid,
        userId: payload.sub,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    return { success: true };
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = dto.email.trim().toLowerCase();
    const genericMessage =
      'If an account with this email exists, a temporary password has been sent.';

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        displayName: true,
      },
    });

    if (!user) {
      return {
        success: true,
        message: genericMessage,
      };
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const delivery = await this.smtpMailerService.sendTemporaryPasswordEmail({
      to: user.email,
      displayName: user.displayName,
      temporaryPassword,
    });

    const passwordHash = await bcrypt.hash(temporaryPassword, 12);

    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
        }),
        this.prisma.session.updateMany({
          where: {
            userId: user.id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        }),
      ]);
    } catch {
      throw new InternalServerErrorException('Failed to reset password');
    }

    return {
      success: true,
      message: delivery.previewOnly
        ? 'SMTP is not configured. Use the temporary password below for local development.'
        : genericMessage,
      temporaryPassword: delivery.previewOnly ? temporaryPassword : null,
    };
  }

  private async createSessionAndTokens(
    user: User,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<AuthTokens> {
    const sessionId = randomUUID();

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        username: user.username,
        type: 'access',
      },
      {
        secret: this.getAccessSecret(),
        expiresIn: this.getAccessTtl(),
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        sid: sessionId,
        type: 'refresh',
      },
      {
        secret: this.getRefreshSecret(),
        expiresIn: this.getRefreshTtl(),
      },
    );

    const refreshPayload = await this.verifyRefreshToken(refreshToken);
    const refreshTokenHash = await bcrypt.hash(refreshToken, 12);

    await this.prisma.session.create({
      data: {
        id: sessionId,
        userId: user.id,
        refreshTokenHash,
        userAgent,
        ipAddress,
        expiresAt: new Date(refreshPayload.exp * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  private async verifyRefreshToken(
    refreshToken: string,
    ignoreExpiration = false,
  ): Promise<RefreshPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<RefreshPayload>(
        refreshToken,
        {
          secret: this.getRefreshSecret(),
          ignoreExpiration,
        },
      );

      if (payload.type !== 'refresh' || !payload.sid || !payload.sub) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private toPublicUser(user: User) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarKey: user.avatarKey,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private getAccessSecret() {
    return getAccessSecret();
  }

  private getRefreshSecret() {
    return getRefreshSecret();
  }

  private getAccessTtl() {
    return this.parseTtlToSeconds(process.env.JWT_ACCESS_TTL, '15m');
  }

  private getRefreshTtl() {
    return this.parseTtlToSeconds(process.env.JWT_REFRESH_TTL, '30d');
  }

  private parseTtlToSeconds(
    value: string | undefined,
    fallback: string,
  ): number {
    const raw = (value || fallback).trim().toLowerCase();
    const numeric = Number(raw);

    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.floor(numeric);
    }

    const match = raw.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(
        `Invalid JWT TTL format: "${raw}". Use number of seconds or suffix s/m/h/d.`,
      );
    }

    const amount = Number(match[1]);
    const unit = match[2];

    if (unit === 's') return amount;
    if (unit === 'm') return amount * 60;
    if (unit === 'h') return amount * 60 * 60;
    return amount * 60 * 60 * 24;
  }

  private generateTemporaryPassword() {
    const randomPart = randomBytes(6).toString('base64url');
    return `Swt-${randomPart}9a`;
  }
}
