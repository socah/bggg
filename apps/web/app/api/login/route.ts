import { NextRequest } from 'next/server';
import { signIn } from '@/auth';

// A GET to Auth.js's own '/api/auth/signin/keycloak' isn't supported
// (@auth/core throws UnknownAction for a GET with a provider segment), and
// calling signIn() directly from a page's render isn't allowed either
// (Next.js only permits setting cookies — which signIn() needs, for PKCE
// state — from a Server Action or Route Handler). This route exists so
// proxy.ts has somewhere it CAN redirect unauthenticated requests straight
// to Keycloak, in one hop, with no intermediate Auth.js page to click through.
export async function GET(request: NextRequest) {
  const callbackUrl = request.nextUrl.searchParams.get('callbackUrl') ?? '/';
  return signIn('keycloak', { redirectTo: callbackUrl });
}
