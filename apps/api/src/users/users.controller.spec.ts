import { Test } from '@nestjs/testing';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { DataSource } from 'typeorm';

describe('UsersController', () => {
  const keycloakAdmin = {
    getUser: jest.fn(),
    updateUser: jest.fn(),
  };
  const usersService = { deleteAccount: jest.fn() };
  let controller: UsersController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: KeycloakAdminClient, useValue: keycloakAdmin },
        { provide: UsersService, useValue: usersService },
        { provide: DataSource, useValue: { query: jest.fn() } },
      ],
    }).compile();
    controller = module.get(UsersController);
    jest.clearAllMocks();
  });

  it('reads only the authenticated user profile', async () => {
    keycloakAdmin.getUser.mockResolvedValue({ id: 'user-1', username: 'alice' });

    await controller.getProfile({ user: { sub: 'user-1' } });

    expect(keycloakAdmin.getUser).toHaveBeenCalledWith('user-1');
  });

  it('trims editable optional profile fields', async () => {
    keycloakAdmin.updateUser.mockResolvedValue({ id: 'user-1', username: 'alice' });

    await controller.updateProfile(
      { user: { sub: 'user-1' } },
      { email: ' alice@example.com ', firstName: ' Alice ', lastName: ' Anderson ' },
    );

    expect(keycloakAdmin.updateUser).toHaveBeenCalledWith('user-1', {
      email: 'alice@example.com',
      firstName: 'Alice',
      lastName: 'Anderson',
    });
  });

  it('deletes only the authenticated account', async () => {
    await controller.deleteAccount({ user: { sub: 'user-1' } });

    expect(usersService.deleteAccount).toHaveBeenCalledWith('user-1');
  });
});
