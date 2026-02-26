import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateDisplayNameDto } from './dto/update-display-name.dto';

const ALLOWED_AVATAR_KEYS = [
  'none',
  'cool-cat',
  'doge',
  'froggy',
  'capy',
  'shiba',
  'alien',
  'robot',
  'banana',
  'penguin',
  'panda',
] as const;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarKey: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async search(currentUserId: string, query?: string) {
    const q = query?.trim().toLowerCase();

    if (!q) {
      return [];
    }

    return this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        username: {
          contains: q,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarKey: true,
        email: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 20,
    });
  }

  async updateAvatar(userId: string, dto: UpdateAvatarDto) {
    const incoming = dto.avatarKey?.trim() || 'none';
    if (!ALLOWED_AVATAR_KEYS.includes(incoming as (typeof ALLOWED_AVATAR_KEYS)[number])) {
      throw new BadRequestException('Avatar option not found');
    }

    const avatarKey = incoming === 'none' ? null : incoming;

    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarKey: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async updateDisplayName(userId: string, dto: UpdateDisplayNameDto) {
    const displayName = dto.displayName.trim();

    return this.prisma.user.update({
      where: { id: userId },
      data: { displayName },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarKey: true,
        email: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }
}
