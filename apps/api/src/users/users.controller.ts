import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(AccessTokenGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUserId() userId: string) {
    return this.usersService.getMe(userId);
  }

  @Get('search')
  search(@Query('query') query?: string) {
    return this.usersService.search(query);
  }
}
