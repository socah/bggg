import { NextRequest, NextResponse } from 'next/server';

export function GET(request: NextRequest) {
  const issuer = process.env.AUTH_KEYCLOAK_ISSUER;
  const clientId = process.env.AUTH_KEYCLOAK_ID;

  if (!issuer || !clientId) {
    return NextResponse.json({ error: 'Keycloak logout is not configured' }, { status: 500 });
  }

  const logoutUrl = new URL(`${issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`);
  logoutUrl.searchParams.set('client_id', clientId);
  logoutUrl.searchParams.set(
    'post_logout_redirect_uri',
    new URL('/web/login', process.env.AUTH_URL ?? request.url).toString(),
  );

  return NextResponse.redirect(logoutUrl);
}
