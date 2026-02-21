import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { CreateDirectConversationDto } from './dto/create-direct-conversation.dto';
import { ConversationsService } from './conversations.service';

@Controller('conversations')
@UseGuards(AccessTokenGuard)
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post('direct')
  createDirect(
    @CurrentUserId() currentUserId: string,
    @Body() dto: CreateDirectConversationDto,
  ) {
    return this.conversationsService.createDirect(currentUserId, dto.userId);
  }

  @Get()
  list(@CurrentUserId() currentUserId: string) {
    return this.conversationsService.list(currentUserId);
  }

  @Get(':id/messages')
  messages(
    @CurrentUserId() currentUserId: string,
    @Param('id') conversationId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.conversationsService.getMessages(
      currentUserId,
      conversationId,
      cursor,
      limit,
    );
  }

  @Post(':id/read')
  @HttpCode(200)
  markRead(
    @CurrentUserId() currentUserId: string,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.markRead(currentUserId, conversationId);
  }
}
