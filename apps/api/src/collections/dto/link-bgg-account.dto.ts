import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class LinkBggAccountDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  bggUsername!: string;
}
