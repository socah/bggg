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
    const mockCreated = (locationId = 'new-user-id') =>
      mockHttpService.post
        .mockReturnValueOnce(of({ status: 200, data: { access_token: 'service-token', expires_in: 60 } }))
        .mockReturnValueOnce(
          of({
            status: 201,
            headers: {
              location: `http://keycloak:8080/admin/realms/boardgame/users/${locationId}`,
            },
          }),
        );

    it('should derive the username from the email local part when no username is given', async () => {
      mockCreated();

      const userId = await client.createUser({
        email: 'alice@example.com',
        password: 'hunter2',
      });

      expect(userId).toBe('new-user-id');
      expect(mockHttpService.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ username: 'alice', email: 'alice@example.com' }),
        expect.any(Object),
      );
    });

    it('should use an explicit username as-is, even when an email is also given', async () => {
      mockCreated();

      await client.createUser({
        email: 'alice@example.com',
        username: 'alice-the-great',
        password: 'hunter2',
      });

      expect(mockHttpService.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ username: 'alice-the-great', email: 'alice@example.com' }),
        expect.any(Object),
      );
    });

    it('should register with a username alone, sending no email at all', async () => {
      mockCreated();

      await client.createUser({ username: 'alice', password: 'hunter2' });

      const [, body] = mockHttpService.post.mock.calls[1];
      expect(body).toEqual(
        expect.objectContaining({ username: 'alice', enabled: true }),
      );
      expect(body).not.toHaveProperty('email');
    });

    it('should omit firstName and lastName when neither is given — names are optional', async () => {
      mockCreated();

      await client.createUser({ email: 'alice@example.com', password: 'hunter2' });

      const [, body] = mockHttpService.post.mock.calls[1];
      expect(body).not.toHaveProperty('firstName');
      expect(body).not.toHaveProperty('lastName');
    });

    it('should include firstName and lastName when they are given', async () => {
      mockCreated();

      await client.createUser({
        email: 'alice@example.com',
        firstName: 'Alice',
        lastName: 'Anderson',
        password: 'hunter2',
      });

      expect(mockHttpService.post).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ firstName: 'Alice', lastName: 'Anderson' }),
        expect.any(Object),
      );
    });

    it('should throw a 409 mentioning both username and email when either is already taken', async () => {
      mockHttpService.post
        .mockReturnValueOnce(of({ status: 200, data: { access_token: 'service-token', expires_in: 60 } }))
        .mockReturnValueOnce(of({ status: 409, headers: {} }));

      await expect(
        client.createUser({ email: 'alice@example.com', password: 'hunter2' }),
      ).rejects.toMatchObject({ message: 'An account with this username or email already exists' });
    });
  });

  describe('getUser', () => {
    it('should return the user id and firstName as displayName', async () => {
      // getUser first needs a service-account token (same private
      // getServiceToken() every other method here already goes through).
      mockHttpService.post.mockReturnValue(
        of({ status: 200, data: { access_token: 'service-token', expires_in: 60 } }),
      );
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: { id: 'user-1', username: 'alice', firstName: 'Alice' } }),
      );

      const result = await client.getUser('user-1');

      expect(result).toEqual({ id: 'user-1', displayName: 'Alice' });
    });

    it('should fall back to username when firstName is unset', async () => {
      mockHttpService.post.mockReturnValue(
        of({ status: 200, data: { access_token: 'service-token', expires_in: 60 } }),
      );
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: { id: 'user-2', username: 'bob' } }),
      );

      const result = await client.getUser('user-2');

      expect(result).toEqual({ id: 'user-2', displayName: 'bob' });
    });

    it('should fall back to username when firstName is blank', async () => {
      mockHttpService.post.mockReturnValue(
        of({ status: 200, data: { access_token: 'service-token', expires_in: 60 } }),
      );
      mockHttpService.get.mockReturnValue(
        of({ status: 200, data: { id: 'user-3', username: 'carol', firstName: '' } }),
      );

      await expect(client.getUser('user-3')).resolves.toEqual({ id: 'user-3', displayName: 'carol' });
    });
  });
});
