import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateDisplayNameDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  displayName!: string;
}
