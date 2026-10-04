import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { sessionCookieName, signOut } from '@/auth';

export async function GET(request: NextRequest) {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER;
  const clientId = process.env.AUTH_KEYCLOAK_ID;
  const secret = process.env.AUTH_SECRET;

  if (!issuer || !clientId || !secret) {
    return NextResponse.json({ error: 'Keycloak logout is not configured' }, { status: 500 });
  }

  const token = await getToken({
    req: request,
    secret,
    cookieName: sessionCookieName,
  });
  await signOut({ redirect: false });

  const logoutUrl = new URL(`${issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`);
  logoutUrl.searchParams.set('client_id', clientId);
  if (typeof token?.idToken === 'string') logoutUrl.searchParams.set('id_token_hint', token.idToken);
  logoutUrl.searchParams.set(
    'post_logout_redirect_uri',
    new URL('/web/login', process.env.AUTH_URL ?? request.url).toString(),
  );

  return NextResponse.redirect(logoutUrl);
}
