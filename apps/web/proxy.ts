import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// Auth.js wraps this callback: `req.auth` is the decoded session (or null)
// from the session cookie, checked before the request reaches any page.
// This never calls Keycloak itself — it only reads the already-issued
// session cookie, so it's safe to run for every matched request.
export default auth((req) => {
  if (!req.auth) {
    // '/web/login' (not Auth.js's own '/web/auth/signin') is the redirect
    // target — see that route's own comment for why: a GET to
    // '/web/auth/signin/keycloak' isn't a supported Auth.js action, and the
    // provider-less '/web/auth/signin' would only get us to a page with a
    // "Sign in with Keycloak" button, not a direct one-hop redirect.
    const loginUrl = new URL('/web/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // Matches everything except: public invite routes, the NextAuth routes and
  // login/logout redirects (or auth becomes an infinite redirect loop), Next.js internals, and
  // the offline route and PWA/static assets emitted by next-pwa, which must
  // load unauthenticated for installation and push delivery to work.
  matcher: [
    '/((?!invites|offline|web/auth|web/login|web/logout|_next/static|_next/image|favicon.ico|manifest.json|icons/|sw\\.js|workbox-.*\\.js|worker-.*\\.js|swe-worker-.*\\.js|fallback-.*\\.js).*)',
  ],
};
