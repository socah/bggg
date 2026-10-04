import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { NextRequest } from 'next/server';

const getToken = jest.fn<() => Promise<{ idToken: string } | null>>();
const signOut = jest.fn<(options: { redirect: boolean }) => Promise<void>>();

jest.unstable_mockModule('next-auth/jwt', () => ({ getToken }));
jest.unstable_mockModule('@/auth', () => ({
  sessionCookieName: 'authjs.session-token',
  signOut,
}));

const { GET } = await import('./route');

const originalAuthUrl = process.env.AUTH_URL;
const originalIssuer = process.env.AUTH_KEYCLOAK_ISSUER;
const originalClientId = process.env.AUTH_KEYCLOAK_ID;
const originalSecret = process.env.AUTH_SECRET;

afterEach(() => {
  process.env.AUTH_URL = originalAuthUrl;
  process.env.AUTH_KEYCLOAK_ISSUER = originalIssuer;
  process.env.AUTH_KEYCLOAK_ID = originalClientId;
  process.env.AUTH_SECRET = originalSecret;
  jest.clearAllMocks();
});

describe('GET /web/logout', () => {
  it('clears the local session and supplies Keycloak an ID token hint', async () => {
    process.env.AUTH_URL = 'https://bggg.duckdns.org';
    process.env.AUTH_KEYCLOAK_ISSUER = 'https://bggg.duckdns.org/auth/realms/boardgame';
    process.env.AUTH_KEYCLOAK_ID = 'web';
    process.env.AUTH_SECRET = 'test-secret';
    getToken.mockResolvedValue({ idToken: 'signed-id-token' });

    const response = await GET(new NextRequest('http://0.0.0.0:3000/web/logout'));
    const location = new URL(response.headers.get('location')!);

    expect(location.searchParams.get('post_logout_redirect_uri'))
      .toBe('https://bggg.duckdns.org/web/login');
    expect(location.searchParams.get('id_token_hint')).toBe('signed-id-token');
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });
});
