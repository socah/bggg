import { IsString, MaxLength } from 'class-validator';

export class ExcludeMarketListingDto {
  @IsString()
  @MaxLength(2000)
  url!: string;
}
