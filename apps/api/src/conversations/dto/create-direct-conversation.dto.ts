import { IsString, MinLength } from 'class-validator';

export class CreateDirectConversationDto {
  @IsString()
  @MinLength(3)
  userId!: string;
}
