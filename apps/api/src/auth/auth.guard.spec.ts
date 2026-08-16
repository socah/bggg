describe('auth.guard ISSUER selection', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses KEYCLOAK_ISSUER verbatim when set', async () => {
    process.env.KEYCLOAK_ISSUER =
      'https://bggg.duckdns.org/auth/realms/boardgame';
    process.env.KEYCLOAK_URL = 'http://keycloak:8080';
    process.env.KEYCLOAK_REALM = 'boardgame';

    const mod = await import('./auth.guard');
    expect(mod.ISSUER).toBe('https://bggg.duckdns.org/auth/realms/boardgame');
  });

  it('falls back to the KEYCLOAK_URL-derived issuer when KEYCLOAK_ISSUER is unset', async () => {
    delete process.env.KEYCLOAK_ISSUER;
    process.env.KEYCLOAK_URL = 'http://localhost:8080';
    process.env.KEYCLOAK_REALM = 'boardgame';

    const mod = await import('./auth.guard');
    expect(mod.ISSUER).toBe('http://localhost:8080/realms/boardgame');
  });
});
