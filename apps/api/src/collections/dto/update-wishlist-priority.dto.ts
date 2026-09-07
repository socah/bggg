import { IsInt, Max, Min } from 'class-validator';

export class UpdateWishlistPriorityDto {
  @IsInt()
  @Min(1)
  @Max(5)
  wishlistPriority!: number;
}
