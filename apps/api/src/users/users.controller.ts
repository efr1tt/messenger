import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { UpdateDisplayNameDto } from './dto/update-display-name.dto';
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
  search(@CurrentUserId() userId: string, @Query('query') query?: string) {
    return this.usersService.search(userId, query);
  }

  @Patch('me/avatar')
  updateAvatar(@CurrentUserId() userId: string, @Body() dto: UpdateAvatarDto) {
    return this.usersService.updateAvatar(userId, dto);
  }

  @Patch('me/display-name')
  updateDisplayName(
    @CurrentUserId() userId: string,
    @Body() dto: UpdateDisplayNameDto,
  ) {
    return this.usersService.updateDisplayName(userId, dto);
  }
}
