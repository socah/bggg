import { afterEach, describe, expect, it } from '@jest/globals';
import { NextRequest } from 'next/server';
import { GET } from './route';

const originalAuthUrl = process.env.AUTH_URL;
const originalIssuer = process.env.AUTH_KEYCLOAK_ISSUER;
const originalClientId = process.env.AUTH_KEYCLOAK_ID;

afterEach(() => {
  process.env.AUTH_URL = originalAuthUrl;
  process.env.AUTH_KEYCLOAK_ISSUER = originalIssuer;
  process.env.AUTH_KEYCLOAK_ID = originalClientId;
});

describe('GET /web/logout', () => {
  it('uses the public Auth.js URL for the post-logout redirect', () => {
    process.env.AUTH_URL = 'https://bggg.duckdns.org';
    process.env.AUTH_KEYCLOAK_ISSUER = 'https://bggg.duckdns.org/auth/realms/boardgame';
    process.env.AUTH_KEYCLOAK_ID = 'web';

    const response = GET(new NextRequest('http://0.0.0.0:3000/web/logout'));
    const location = new URL(response.headers.get('location')!);

    expect(location.searchParams.get('post_logout_redirect_uri'))
      .toBe('https://bggg.duckdns.org/web/login');
  });
});
