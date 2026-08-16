import { NextResponse } from 'next/server';
import { auth } from '@/auth';

// Auth.js wraps this callback: `req.auth` is the decoded session (or null)
// from the session cookie, checked before the request reaches any page.
// This never calls Keycloak itself — it only reads the already-issued
// session cookie, so it's safe to run for every matched request.
export default auth((req) => {
  if (!req.auth) {
    // '/api/login' (not Auth.js's own '/api/auth/signin') is the redirect
    // target — see that route's own comment for why: a GET to
    // '/api/auth/signin/keycloak' isn't a supported Auth.js action, and the
    // provider-less '/api/auth/signin' would only get us to a page with a
    // "Sign in with Keycloak" button, not a direct one-hop redirect.
    const loginUrl = new URL('/api/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  // Matches everything except: the NextAuth API routes and '/api/login'
  // itself (or sign-in becomes an infinite redirect loop), Next.js
  // internals, and the PWA/static assets emitted by next-pwa (sw.js,
  // workbox-*.js, manifest.json) which must load unauthenticated for the
  // app shell to work.
  matcher: [
    '/((?!api/auth|api/login|_next/static|_next/image|favicon.ico|manifest.json|sw\\.js|workbox-.*\\.js).*)',
  ],
};
