import { NextRequest } from 'next/server';
import { signIn } from '@/auth';

// A GET to Auth.js's own '/web/auth/signin/keycloak' isn't supported
// (@auth/core throws UnknownAction for a GET with a provider segment), and
// calling signIn() directly from a page's render isn't allowed either
// (Next.js only permits setting cookies — which signIn() needs, for PKCE
// state — from a Server Action or Route Handler). This route exists so
// proxy.ts has somewhere it CAN redirect unauthenticated requests straight
// to Keycloak, in one hop, with no intermediate Auth.js page to click through.
//
// Lives under '/web' (not '/api'): Traefik and next.config.ts's rewrite both
// treat '/api/*' as "always the NestJS backend" — see docker-compose.yml's
// 'api' router. Auth.js's own routes need the same carve-out (see
// apps/web/auth.ts's basePath), and having both live under '/web' instead
// means neither Traefik nor the rewrite needs a special-case exclusion for
// them at all; '/api/*' stays a clean, unconditional rule.
export async function GET(request: NextRequest) {
  const callbackUrl = request.nextUrl.searchParams.get('callbackUrl') ?? '/';
  return signIn('keycloak', { redirectTo: callbackUrl });
}
