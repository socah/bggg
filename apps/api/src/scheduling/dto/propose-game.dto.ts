import { IsInt, IsPositive } from 'class-validator';

export class ProposeGameDto {
  @IsInt()
  @IsPositive()
  gameId!: number;
}
