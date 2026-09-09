import { IsNotEmpty, IsString } from 'class-validator';

export class LinkGuestPlayerDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
