import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService } from './messages.service';

@Controller('messages')
@UseGuards(AccessTokenGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post()
  @HttpCode(201)
  send(@CurrentUserId() currentUserId: string, @Body() dto: SendMessageDto) {
    return this.messagesService.send(currentUserId, dto.conversationId, dto.text);
  }
}
