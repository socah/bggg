import { IsEmail, IsString, MinLength } from 'class-validator';

// Used by POST /invites/:token/register — the only public, unauthenticated
// endpoint that creates a Keycloak account. See notes/3_invite_system.md
// Decision 4's "Password handling for register" for why a real password is
// accepted here instead of a Keycloak-issued temporary one.
export class RegisterInviteDto {
  @IsEmail()
  email!: string;

  @IsString()
  displayName!: string;

  // A floor, not the only check — Keycloak's own realm password policy
  // (currently unset) would layer on top of this if one's ever configured.
  @IsString()
  @MinLength(8)
  password!: string;
}
