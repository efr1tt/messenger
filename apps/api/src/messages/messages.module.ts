import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';

@Module({
  imports: [AuthModule, ConversationsModule, ChatModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
