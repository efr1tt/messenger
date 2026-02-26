import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/decorators/current-user-id.decorator';
import { AccessTokenGuard } from '../auth/guards/access-token.guard';
import { RespondFriendRequestDto } from './dto/respond-friend-request.dto';
import { RequestFriendDto } from './dto/request-friend.dto';
import { FriendsService } from './friends.service';

@Controller('friends')
@UseGuards(AccessTokenGuard)
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Post('request')
  request(@CurrentUserId() userId: string, @Body() dto: RequestFriendDto) {
    return this.friendsService.requestFriend(userId, dto.toUserId);
  }

  @Post('accept')
  @HttpCode(200)
  accept(
    @CurrentUserId() userId: string,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.friendsService.acceptRequest(userId, dto.requestId);
  }

  @Post('decline')
  @HttpCode(200)
  decline(
    @CurrentUserId() userId: string,
    @Body() dto: RespondFriendRequestDto,
  ) {
    return this.friendsService.declineRequest(userId, dto.requestId);
  }

  @Get()
  getFriends(@CurrentUserId() userId: string) {
    return this.friendsService.getFriends(userId);
  }

  @Get('requests')
  getIncomingRequests(@CurrentUserId() userId: string) {
    return this.friendsService.getIncomingRequests(userId);
  }
}
