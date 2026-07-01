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
const ISSUER = `${KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`;

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

      // Attach the decoded payload to the request so any controller can read
      // req.user.sub (the user's ID) without decoding the token a second time.
      const request = context.switchToHttp().getRequest();
      request.user = payload;

      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  // All transport-specific logic lives here — canActivate never calls
  // switchToHttp() or switchToWs() directly. When WebSockets are added in
  // Phase 3, only this method grows a new branch; nothing else changes.
  private extractToken(context: ExecutionContext): string | null {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest();
      // Authorization header format: "Bearer <token>"
      // split(' ')[1] isolates the token part after the space.
      return request.headers.authorization?.split(' ')[1] ?? null;
    }
    // 'ws' branch will be added here in Phase 3 when group chat is built.
    return null;
  }
}
