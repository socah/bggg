import { IsString, IsNotEmpty } from 'class-validator';

// Setting a host and clearing one are separate endpoints (PATCH vs DELETE
// on /proposals/:id/host) specifically so this DTO never has to represent
// "set to a user" and "clear" as the same optional/nullable field.
export class DesignateHostDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
