import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessTokenGuard } from './guards/access-token.guard';
import { SmtpMailerService } from './smtp-mailer.service';

@Module({
  imports: [PrismaModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, SmtpMailerService],
  exports: [AuthService, JwtModule, AccessTokenGuard],
})
export class AuthModule {}
