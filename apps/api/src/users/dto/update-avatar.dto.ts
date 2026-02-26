import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAvatarDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  avatarKey?: string | null;
}
