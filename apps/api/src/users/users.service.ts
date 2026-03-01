import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateDisplayNameDto } from './dto/update-display-name.dto';

const AVATAR_KEY_ALIASES = {
  none: 'none',
  orbit: 'orbit',
  ember: 'ember',
  mint: 'mint',
  neon: 'neon',
  sunset: 'sunset',
  citrus: 'citrus',
  midnight: 'midnight',
  coral: 'coral',
  classic: 'orbit',
  cool: 'ember',
  smirk: 'mint',
  calm: 'neon',
  wink: 'sunset',
  monocle: 'citrus',
  nerd: 'midnight',
  mustache: 'coral',
  halo: 'ember',
  thinking: 'mint',
  'cool-cat': 'orbit',
  doge: 'ember',
  froggy: 'mint',
  capy: 'neon',
  shiba: 'sunset',
  alien: 'citrus',
  robot: 'midnight',
  banana: 'coral',
  penguin: 'orbit',
  panda: 'mint',
} as const;

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
    const normalized = AVATAR_KEY_ALIASES[incoming as keyof typeof AVATAR_KEY_ALIASES];

    if (!normalized) {
      throw new BadRequestException('Avatar option not found');
    }

    const avatarKey = normalized === 'none' ? null : normalized;

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
