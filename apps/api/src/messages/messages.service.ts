import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationsService: ConversationsService,
  ) {}

  async send(currentUserId: string, conversationId: string, text: string) {
    const normalizedText = text.trim();

    if (!normalizedText) {
      throw new BadRequestException('Message text cannot be empty');
    }

    await this.conversationsService.ensureMembership(currentUserId, conversationId);

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        isDirect: true,
        members: {
          select: { userId: true },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.isDirect) {
      const peer = conversation.members.find((member) => member.userId !== currentUserId);
      if (!peer) {
        throw new BadRequestException('Direct conversation is invalid');
      }

      const areFriends = await this.prisma.friendship.findUnique({
        where: {
          userId_friendId: {
            userId: currentUserId,
            friendId: peer.userId,
          },
        },
        select: { id: true },
      });

      if (!areFriends) {
        throw new BadRequestException('You can send messages only to friends');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          conversationId,
          senderId: currentUserId,
          text: normalizedText,
        },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          text: true,
          createdAt: true,
        },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });

      return message;
    });
  }
}
