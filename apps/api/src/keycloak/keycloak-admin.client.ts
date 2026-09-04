import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

// Same container-name-vs-localhost split as AuthGuard and BggService.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const REALM = process.env.KEYCLOAK_REALM;

// This client authenticates as ITSELF (the 'api-service' client), never on
// behalf of a human — see the 'api-service' entry in boardgame-realm.json.
const CLIENT_ID = process.env.KEYCLOAK_API_SERVICE_ID ?? 'api-service';
const CLIENT_SECRET = process.env.KEYCLOAK_API_SERVICE_SECRET;

export interface CreateKeycloakUserInput {
  // At least one of these two must be set — InvitesService enforces that
  // before this is ever called.
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  password: string;
}

export interface KeycloakUserInfo {
  id: string;
  displayName: string;
}

// Wraps the two Keycloak Admin API calls InvitesService needs. Uses
// HttpService (not raw axios) for the same reason BggService does — see
// bgg.service.spec.ts — a mockable HTTP client the test suite can swap out.
@Injectable()
export class KeycloakAdminClient {
  // In-memory cache for the service-account token. Keycloak issues these
  // short-lived (default 60s); re-authenticating on every single call would
  // be one extra round trip per invite registration for no benefit.
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(private readonly http: HttpService) {}

  // Creates a real Keycloak account and returns its 'sub' — the same value
  // that will appear in every JWT this person presents from now on, and
  // therefore the value InvitesService writes into group_members.userId.
  async createUser(input: CreateKeycloakUserInput): Promise<string> {
    const token = await this.getServiceToken();

    // Keycloak always needs a username. If the invitee didn't pick one but
    // did give an email, derive it from the local part (before the '@') so
    // they're not forced to invent a second identifier just for this.
    const username = input.username ?? input.email!.split('@')[0];

    const response = await firstValueFrom(
      this.http.post(
        `${KEYCLOAK_URL}/admin/realms/${REALM}/users`,
        {
          username,
          ...(input.email && { email: input.email }),
          ...(input.firstName && { firstName: input.firstName }),
          ...(input.lastName && { lastName: input.lastName }),
          enabled: true,
          // See notes/3_invite_system.md's "Password handling for register":
          // set as a real, non-temporary credential — there is no email
          // infra in this project to hand off a temporary one instead.
          credentials: [{ type: 'password', value: input.password, temporary: false }],
        },
        {
          headers: { Authorization: `Bearer ${token}` },
          // Without this, axios rejects the promise itself on any non-2xx
          // status, which would make a 409 (username/email already taken)
          // indistinguishable from a network failure. Inspecting
          // response.status ourselves below lets us tell them apart.
          validateStatus: () => true,
        },
      ),
    );

    if (response.status === 409) {
      throw new HttpException('An account with this username or email already exists', 409);
    }
    if (response.status !== 201) {
      throw new HttpException(`Keycloak user creation failed (${response.status})`, 502);
    }

    // Keycloak does not return the created user in the response body — only
    // in the Location header, e.g. ".../admin/realms/boardgame/users/<uuid>".
    const location = response.headers['location'] as string | undefined;
    const userId = location?.split('/').pop();
    if (!userId) {
      throw new HttpException('Keycloak did not return a user id', 502);
    }

    return userId;
  }

  // Resolves a Keycloak sub to a display name — nothing else in this
  // backend does this for anyone but the logged-in user themself (their
  // own JWT claims). Used to label proposers/hosts/RSVPs by name instead
  // of raw subs. firstName is optional at registration (see createUser)
  // and so is frequently unset — username is always present, so it's the
  // fallback.
  async getUser(userId: string): Promise<KeycloakUserInfo> {
    const token = await this.getServiceToken();

    const response = await firstValueFrom(
      this.http.get(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      }),
    );

    if (response.status !== 200) {
      throw new HttpException(`Keycloak user lookup failed (${response.status})`, 502);
    }

    return {
      id: response.data.id,
      displayName: response.data.firstName?.trim() || response.data.username,
    };
  }

  // Compensating action for InvitesService.registerAndAcceptInvite: if
  // redeeming the invite fails AFTER this account was created, there is no
  // single transaction spanning Keycloak and Postgres to roll back — the
  // best we can do is delete what we just created so a retry doesn't hit
  // "email already exists" for an account that never got a group. Best
  // effort: if this itself fails, the caller logs it and moves on rather
  // than compounding one failure with an unhandled second one.
  async deleteUser(userId: string): Promise<void> {
    const token = await this.getServiceToken();

    await firstValueFrom(
      this.http.delete(`${KEYCLOAK_URL}/admin/realms/${REALM}/users/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
        validateStatus: () => true,
      }),
    );
    // Not checking the response status here: whether this succeeds (204),
    // the user was already gone (404), or it fails outright, the caller's
    // job is already done — log and move on, per the comment above.
  }

  private async getServiceToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now()) {
      return this.cachedToken.accessToken;
    }

    // application/x-www-form-urlencoded, not JSON — this is Keycloak's
    // standard OAuth2 token endpoint, not a Keycloak-specific admin route.
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET ?? '',
    });

    let response;
    try {
      response = await firstValueFrom(
        this.http.post<{ access_token: string; expires_in: number }>(
          `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
          body.toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
          },
        ),
      );
    } catch {
      throw new HttpException('Identity service is unavailable', 502);
    }

    if (response.status !== 200 || !response.data.access_token) {
      throw new HttpException('Identity service authentication failed', 502);
    }

    this.cachedToken = {
      accessToken: response.data.access_token,
      // 5s safety margin so a token never expires mid-request.
      expiresAt: Date.now() + (response.data.expires_in - 5) * 1000,
    };
    return this.cachedToken.accessToken;
  }
}
