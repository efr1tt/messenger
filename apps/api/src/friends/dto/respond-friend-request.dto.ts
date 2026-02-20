import { IsString, MinLength } from 'class-validator';

export class RespondFriendRequestDto {
  @IsString()
  @MinLength(3)
  requestId!: string;
}
