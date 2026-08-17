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
