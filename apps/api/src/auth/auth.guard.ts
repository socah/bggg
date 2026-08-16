import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// createRemoteJWKSet returns a resolver function, not a key — it fetches
// Keycloak's public keys lazily on first use, caches them by 'kid', and only
// re-fetches if a token shows up referencing a 'kid' it hasn't seen (e.g.
// after Keycloak rotates its signing key). Built once at module load, not
// per-request, so there is no repeated network round trip per login check.
// In Docker Compose the host is the service name 'keycloak'; outside Docker
// (how NestJS normally runs in this project — see DB_HOST in app.module.ts)
// it is 'localhost', reachable via the port mapping in docker-compose.dev.yml.
const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';

const JWKS = createRemoteJWKSet(
  new URL(
    `${KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/certs`,
  ),
);

// The issuer every valid token must claim. Checked explicitly below so a
// token signed by a *different* realm on the same Keycloak instance (or a
// different Keycloak entirely) is rejected even if it were somehow otherwise
// well-formed.
//
// KEYCLOAK_ISSUER (when set) takes priority over deriving the issuer from
// KEYCLOAK_URL: in prod, KEYCLOAK_URL is the container-internal
// http://keycloak:8080 address (used for the JWKS fetch above, which is
// fine staying internal), but real tokens carry Keycloak's public-facing
// issuer (https://<domain>/auth/realms/<realm> — see docker-compose.yml's
// KC_HOSTNAME/KEYCLOAK_ISSUER, which must stay in lockstep with this).
// Those two are never the same value in prod, so deriving from
// KEYCLOAK_URL there would reject every real token. Dev leaves
// KEYCLOAK_ISSUER unset and keeps today's KEYCLOAK_URL-derived behavior,
// which is already correct there (no reverse-proxy hostname pinning).
export const ISSUER =
  process.env.KEYCLOAK_ISSUER ??
  `${KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`;

@Injectable()
export class AuthGuard implements CanActivate {
  // NestJS calls canActivate before every handler this guard protects.
  // Returning true lets the request through; throwing blocks it with 401.
  // jwtVerify is async (it may need to fetch JWKS on first call), so this
  // guard returns a Promise now — CanActivate supports that natively.
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const token = this.extractToken(context);

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    try {
      // jwtVerify looks up the token's 'kid' header in JWKS, then checks
      // signature, expiry, and issuer in one call. algorithms is pinned
      // explicitly — a token claiming any algorithm other than RS256 is
      // rejected before signature checking even happens (see the worked
      // example on algorithm confusion in notes/3_keycloak.md).
      const { payload } = await jwtVerify(token, JWKS, {
        issuer: ISSUER,
        algorithms: ['RS256'],
      });

      // Attach the decoded payload to whichever object the handler will
      // actually receive, so it can read `.sub` (the user's ID) without
      // decoding the token a second time. This has to branch the same way
      // extractToken() does — switchToHttp().getRequest() and
      // switchToWs().getClient() return different underlying objects, and
      // calling the wrong one for the current transport throws.
      if (context.getType() === 'ws') {
        const client = context.switchToWs().getClient();
        client.data.user = payload;
      } else {
        const request = context.switchToHttp().getRequest();
        request.user = payload;
      }

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // Extracting the token is centralised here so canActivate's verification
  // logic (JWKS lookup, issuer check, algorithm pinning) is identical for
  // every transport — only the "where does the raw token come from" part
  // differs between HTTP and WebSocket.
  private extractToken(context: ExecutionContext): string | null {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest();
      // Authorization header format: "Bearer <token>"
      // split(' ')[1] isolates the token part after the space.
      return request.headers.authorization?.split(' ')[1] ?? null;
    }
    if (context.getType() === 'ws') {
      // getClient() returns the underlying Socket.io socket. Socket.io
      // exposes whatever the client passed at connect time under
      // `handshake.auth` — NOT a header, since a WebSocket handshake is a
      // single upgrade request and Socket.io's client API sends `auth` as a
      // dedicated field rather than requiring a raw header to be set.
      // Deliberately NOT `handshake.query` — query strings end up in
      // Traefik access logs (Phase 4), leaking tokens; `auth` does not.
      const client = context.switchToWs().getClient();
      return client.handshake?.auth?.token ?? null;
    }
    return null;
  }
}
