import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { of } from 'rxjs';
import { KeycloakAdminClient } from './keycloak-admin.client';

describe('KeycloakAdminClient', () => {
  let client: KeycloakAdminClient;

  const mockHttpService = {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KeycloakAdminClient,
        { provide: HttpService, useValue: mockHttpService },
      ],
    }).compile();

    client = module.get<KeycloakAdminClient>(KeycloakAdminClient);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createUser', () => {
    it('should set both firstName and lastName, so the account never hits Keycloak\'s default "Update Account Information" prompt for a missing profile field', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ data: { access_token: 'service-token', expires_in: 60 } }))
        .mockReturnValueOnce(
          of({
            status: 201,
            headers: { location: 'http://keycloak:8080/admin/realms/boardgame/users/new-user-id' },
          }),
        );

      const userId = await client.createUser({
        email: 'alice@example.com',
        displayName: 'Alice',
        password: 'hunter2',
      });

      expect(userId).toBe('new-user-id');
      // Keycloak 26's default User Profile schema requires both firstName
      // and lastName — omitting lastName leaves the account looking
      // incomplete to Keycloak, which forces an "Update Account
      // Information" prompt on first login even though this app has no
      // first/last-name concept of its own (getUser() only ever reads
      // firstName). Reusing displayName for both is the simplest way to
      // satisfy that schema without inventing a UX this app doesn't need.
      expect(mockHttpService.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ firstName: 'Alice', lastName: 'Alice' }),
        expect.any(Object),
      );
    });
  });

  describe('getUser', () => {
    it('should return the user id and firstName as displayName', async () => {
      // getUser first needs a service-account token (same private
      // getServiceToken() every other method here already goes through).
      mockHttpService.post.mockReturnValue(
        of({ data: { access_token: 'service-token', expires_in: 60 } }),
      );
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: { id: 'user-1', username: 'alice', firstName: 'Alice' } }),
      );

      const result = await client.getUser('user-1');

      expect(result).toEqual({ id: 'user-1', displayName: 'Alice' });
    });

    it('should fall back to username when firstName is unset', async () => {
      mockHttpService.post.mockReturnValue(
        of({ data: { access_token: 'service-token', expires_in: 60 } }),
      );
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: { id: 'user-2', username: 'bob' } }),
      );

      const result = await client.getUser('user-2');

      expect(result).toEqual({ id: 'user-2', displayName: 'bob' });
    });
  });
});
