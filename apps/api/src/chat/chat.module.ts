import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../redis/redis.module';
import { ChatGateway } from './chat.gateway';

@Module({
  imports: [AuthModule, RedisModule],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class ChatModule {}
