import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

// Used by POST /invites/:token/register — the only public, unauthenticated
// endpoint that creates a Keycloak account. See notes/3_invite_system.md
// Decision 4's "Password handling for register" for why a real password is
// accepted here instead of a Keycloak-issued temporary one.
//
export class RegisterInviteDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(64)
  username!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  // A floor, not the only check — Keycloak's own realm password policy
  // (currently unset) would layer on top of this if one's ever configured.
  @IsString()
  @MinLength(8)
  password!: string;
}
