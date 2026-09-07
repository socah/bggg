import { IsInt, Min } from 'class-validator';

export class AddGameDto {
  @IsInt()
  @Min(1)
  bggId!: number;
}
