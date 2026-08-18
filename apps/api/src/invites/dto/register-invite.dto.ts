import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

// Used by POST /invites/:token/register — the only public, unauthenticated
// endpoint that creates a Keycloak account. See notes/3_invite_system.md
// Decision 4's "Password handling for register" for why a real password is
// accepted here instead of a Keycloak-issued temporary one.
//
// Registration needs at least a username or an email (InvitesService
// enforces that — class-validator has no clean "one of these two" check),
// and doesn't require a name at all. See KeycloakAdminClient.createUser for
// how a username is derived when only an email is given.
export class RegisterInviteDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  username?: string;

  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  // A floor, not the only check — Keycloak's own realm password policy
  // (currently unset) would layer on top of this if one's ever configured.
  @IsString()
  @MinLength(8)
  password!: string;
}
