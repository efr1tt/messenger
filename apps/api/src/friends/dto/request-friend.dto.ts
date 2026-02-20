import { IsString, MinLength } from 'class-validator';

export class RequestFriendDto {
  @IsString()
  @MinLength(3)
  toUserId!: string;
}
