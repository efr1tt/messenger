import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createDirect(currentUserId: string, targetUserId: string) {
    if (currentUserId === targetUserId) {
      throw new BadRequestException(
        'Cannot create a direct conversation with yourself',
      );
    }

    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    const areFriends = await this.prisma.friendship.findUnique({
      where: {
        userId_friendId: {
          userId: currentUserId,
          friendId: targetUserId,
        },
      },
      select: { id: true },
    });

    if (!areFriends) {
      throw new BadRequestException(
        'Direct conversation is allowed only with friends',
      );
    }

    const directKey = this.buildDirectKey(currentUserId, targetUserId);

    const existing = await this.prisma.conversation.findUnique({
      where: { directKey },
      select: {
        id: true,
        isDirect: true,
        createdAt: true,
        updatedAt: true,
        members: {
          select: {
            user: {
              select: {
                id: true,
                username: true,
                displayName: true,
                avatarKey: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (existing) {
      return {
        ...existing,
        members: existing.members.map((m) => m.user),
        unreadCount: 0,
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.create({
        data: {
          isDirect: true,
          directKey,
        },
      });

      await tx.conversationMember.createMany({
        data: [
          {
            conversationId: conversation.id,
            userId: currentUserId,
            lastReadAt: new Date(),
          },
          {
            conversationId: conversation.id,
            userId: targetUserId,
            lastReadAt: new Date(),
          },
        ],
      });

      const created = await tx.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
        select: {
          id: true,
          isDirect: true,
          createdAt: true,
          updatedAt: true,
          members: {
            select: {
              user: {
                select: {
                  id: true,
                  username: true,
                  displayName: true,
                  avatarKey: true,
                  email: true,
                },
              },
            },
          },
        },
      });

      return {
        ...created,
        members: created.members.map((m) => m.user),
        unreadCount: 0,
      };
    });
  }

  async list(currentUserId: string) {
    const memberships = await this.prisma.conversationMember.findMany({
      where: { userId: currentUserId },
      select: {
        lastReadAt: true,
        conversation: {
          select: {
            id: true,
            isDirect: true,
            createdAt: true,
            updatedAt: true,
            members: {
              select: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    displayName: true,
                    avatarKey: true,
                    email: true,
                  },
                },
              },
            },
            messages: {
              select: {
                id: true,
                conversationId: true,
                text: true,
                senderId: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        conversation: {
          updatedAt: 'desc',
        },
      },
    });

    const unreadCounts = await Promise.all(
      memberships.map(async (membership) => {
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: membership.conversation.id,
            senderId: { not: currentUserId },
            ...(membership.lastReadAt
              ? { createdAt: { gt: membership.lastReadAt } }
              : {}),
          },
        });

        return [membership.conversation.id, unreadCount] as const;
      }),
    );

    const unreadByConversationId = new Map(unreadCounts);

    return memberships.map((membership) => {
      const { conversation } = membership;
      const [lastMessage] = conversation.messages;

      return {
        id: conversation.id,
        isDirect: conversation.isDirect,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        members: conversation.members.map((m) => m.user),
        lastMessage: lastMessage || null,
        unreadCount: unreadByConversationId.get(conversation.id) || 0,
      };
    });
  }

  async getMessages(
    currentUserId: string,
    conversationId: string,
    cursor?: string,
    limit = 30,
  ) {
    await this.ensureMembership(currentUserId, conversationId);

    const take = this.normalizeLimit(limit);

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      select: {
        id: true,
        conversationId: true,
        text: true,
        senderId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
    });

    const nextCursor =
      messages.length === take ? messages[messages.length - 1].id : null;

    return {
      items: messages.reverse(),
      nextCursor,
    };
  }

  async markRead(currentUserId: string, conversationId: string) {
    await this.ensureMembership(currentUserId, conversationId);

    await this.prisma.conversationMember.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUserId,
        },
      },
      data: {
        lastReadAt: new Date(),
      },
    });

    return {
      success: true,
      conversationId,
    };
  }

  async ensureMembership(currentUserId: string, conversationId: string) {
    const membership = await this.prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: currentUserId,
        },
      },
      select: { id: true },
    });

    if (!membership) {
      throw new NotFoundException('Conversation not found');
    }
  }

  private buildDirectKey(userA: string, userB: string) {
    return [userA, userB].sort().join(':');
  }

  private normalizeLimit(limit: number) {
    if (!Number.isFinite(limit) || limit <= 0) {
      return 30;
    }

    return Math.min(Math.floor(limit), 100);
  }
}
