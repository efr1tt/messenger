import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FriendRequestStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async requestFriend(currentUserId: string, toUserId: string) {
    if (currentUserId === toUserId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: toUserId },
      select: { id: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const friendship = await this.prisma.friendship.findUnique({
      where: {
        userId_friendId: {
          userId: currentUserId,
          friendId: toUserId,
        },
      },
      select: { id: true },
    });

    if (friendship) {
      throw new BadRequestException('Users are already friends');
    }

    const existingRequest = await this.prisma.friendRequest.findUnique({
      where: {
        fromId_toId: {
          fromId: currentUserId,
          toId: toUserId,
        },
      },
    });

    if (existingRequest?.status === FriendRequestStatus.PENDING) {
      throw new BadRequestException('Friend request already sent');
    }

    if (existingRequest) {
      return this.prisma.friendRequest.update({
        where: { id: existingRequest.id },
        data: { status: FriendRequestStatus.PENDING },
      });
    }

    return this.prisma.friendRequest.create({
      data: {
        fromId: currentUserId,
        toId: toUserId,
      },
    });
  }

  async acceptRequest(currentUserId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.toId !== currentUserId) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Friend request is not pending');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedRequest = await tx.friendRequest.update({
        where: { id: request.id },
        data: { status: FriendRequestStatus.ACCEPTED },
      });

      await tx.friendship.createMany({
        data: [
          { userId: request.toId, friendId: request.fromId },
          { userId: request.fromId, friendId: request.toId },
        ],
        skipDuplicates: true,
      });

      return updatedRequest;
    });
  }

  async declineRequest(currentUserId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.toId !== currentUserId) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.status !== FriendRequestStatus.PENDING) {
      throw new BadRequestException('Friend request is not pending');
    }

    return this.prisma.friendRequest.update({
      where: { id: request.id },
      data: { status: FriendRequestStatus.DECLINED },
    });
  }

  async getFriends(currentUserId: string) {
    const items = await this.prisma.friendship.findMany({
      where: { userId: currentUserId },
      select: {
        id: true,
        createdAt: true,
        friend: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true,
            email: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const onlineStatuses = await Promise.all(
      items.map(async (item) => {
        const isOnline = await this.redisService.isUserOnline(item.friend.id);
        return [item.friend.id, isOnline] as const;
      }),
    );

    const onlineMap = new Map(onlineStatuses);

    return items.map((item) => ({
      ...item,
      isOnline: onlineMap.get(item.friend.id) || false,
    }));
  }

  async getIncomingRequests(currentUserId: string) {
    return this.prisma.friendRequest.findMany({
      where: {
        toId: currentUserId,
        status: FriendRequestStatus.PENDING,
      },
      select: {
        id: true,
        status: true,
        createdAt: true,
        from: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarKey: true,
            email: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
