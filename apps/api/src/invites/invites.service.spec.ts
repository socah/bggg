import { createHash } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  GoneException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InvitesService } from './invites.service';
import { Invite } from './invite.entity';
import { GroupMember } from '../groups/group-member.entity';
import { Group } from '../groups/group.entity';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';
import { AuditService } from '../audit/audit.service';

const GROUP_ID = 'group-1';
const OWNER_ID = 'user-owner';

// Same hash InvitesService computes internally — used here only to build
// fixtures and to check what the service actually passed to the repository,
// never imported from the service itself (hashToken is private on purpose).
const hash = (rawToken: string) => createHash('sha256').update(rawToken).digest('hex');

describe('InvitesService', () => {
  let service: InvitesService;

  const mockInvites = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };
  const mockMembers = {
    findOneBy: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };
  const mockGroups = {
    findOneBy: jest.fn(),
  };
  const mockKeycloakAdmin = {
    createUser: jest.fn(),
    deleteUser: jest.fn(),
  };
  const mockAuditService = {
    log: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitesService,
        { provide: getRepositoryToken(Invite), useValue: mockInvites },
        { provide: getRepositoryToken(GroupMember), useValue: mockMembers },
        { provide: getRepositoryToken(Group), useValue: mockGroups },
        { provide: KeycloakAdminClient, useValue: mockKeycloakAdmin },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();

    service = module.get<InvitesService>(InvitesService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── createInvite ─────────────────────────────────────────────────────────

  describe('createInvite', () => {
    it('should throw ForbiddenException when the requester is only a member', async () => {
      mockMembers.findOneBy.mockResolvedValue({ role: 'member' });

      await expect(
        service.createInvite(GROUP_ID, 'member', 'a-member'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockInvites.save).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenException when the requester has no membership at all', async () => {
      mockMembers.findOneBy.mockResolvedValue(null);

      await expect(
        service.createInvite(GROUP_ID, 'member', 'a-stranger'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should save a hashed invite and return a URL containing the raw token', async () => {
      mockMembers.findOneBy.mockResolvedValue({ role: 'owner' });
      mockInvites.create.mockImplementation((entity) => entity);
      mockInvites.save.mockResolvedValue(undefined);

      const { inviteUrl } = await service.createInvite(GROUP_ID, 'admin', OWNER_ID);

      // The raw token is whatever comes after the last '/' in the URL —
      // extract it and confirm ITS hash matches what was actually persisted,
      // proving the plaintext token itself never reaches the database.
      const rawToken = inviteUrl.split('/').pop()!;
      expect(mockInvites.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenHash: hash(rawToken),
          groupId: GROUP_ID,
          role: 'admin',
          createdBy: OWNER_ID,
          usedAt: null,
        }),
      );
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.invite_created' }),
      );
    });
  });

  // ── previewInvite ────────────────────────────────────────────────────────

  describe('previewInvite', () => {
    const rawToken = 'preview-token';

    it('should return the group name and role for a valid invite', async () => {
      mockInvites.findOneBy.mockResolvedValue({
        tokenHash: hash(rawToken),
        groupId: GROUP_ID,
        role: 'member',
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000 * 60),
      });
      mockGroups.findOneBy.mockResolvedValue({ id: GROUP_ID, name: 'Chess Club' });

      const result = await service.previewInvite(rawToken);

      expect(result).toEqual({ groupName: 'Chess Club', role: 'member' });
    });

    it('should throw NotFoundException when no invite matches the token', async () => {
      mockInvites.findOneBy.mockResolvedValue(null);

      await expect(service.previewInvite(rawToken)).rejects.toThrow(NotFoundException);
    });

    it('should throw GoneException when the invite was already used', async () => {
      mockInvites.findOneBy.mockResolvedValue({
        tokenHash: hash(rawToken),
        groupId: GROUP_ID,
        role: 'member',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60),
      });

      await expect(service.previewInvite(rawToken)).rejects.toThrow(GoneException);
    });

    it('should throw GoneException when the invite has expired', async () => {
      mockInvites.findOneBy.mockResolvedValue({
        tokenHash: hash(rawToken),
        groupId: GROUP_ID,
        role: 'member',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.previewInvite(rawToken)).rejects.toThrow(GoneException);
    });
  });

  // ── acceptInvite (Path A — existing account) ────────────────────────────

  describe('acceptInvite', () => {
    const rawToken = 'accept-token';
    const validInvite = {
      tokenHash: hash(rawToken),
      groupId: GROUP_ID,
      role: 'member' as const,
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60),
    };

    it('should redeem the invite and insert a group_members row', async () => {
      mockInvites.findOneBy.mockResolvedValue(validInvite);
      mockInvites.update.mockResolvedValue({ affected: 1 });
      mockMembers.create.mockImplementation((entity) => entity);
      mockMembers.save.mockResolvedValue(undefined);

      const result = await service.acceptInvite(rawToken, 'existing-user');

      expect(mockInvites.update).toHaveBeenCalledWith(
        { tokenHash: validInvite.tokenHash, usedAt: expect.anything() },
        { usedAt: expect.any(Date), usedBy: 'existing-user' },
      );
      expect(mockMembers.create).toHaveBeenCalledWith({
        userId: 'existing-user',
        groupId: GROUP_ID,
        role: 'member',
      });
      expect(result).toEqual({ groupId: GROUP_ID, role: 'member' });
    });

    it('should throw GoneException when a concurrent redemption wins the race', async () => {
      mockInvites.findOneBy.mockResolvedValue(validInvite);
      // affected: 0 means the conditional UPDATE matched no row — someone
      // else's redeem() already flipped usedAt between our read and write.
      mockInvites.update.mockResolvedValue({ affected: 0 });

      await expect(service.acceptInvite(rawToken, 'existing-user')).rejects.toThrow(
        GoneException,
      );
      expect(mockMembers.save).not.toHaveBeenCalled();
    });
  });

  // ── registerAndAcceptInvite (Path B — new account) ──────────────────────

  describe('registerAndAcceptInvite', () => {
    const rawToken = 'register-token';
    const dto = { email: 'new@example.com', password: 'hunter2222' };
    const validInvite = {
      tokenHash: hash(rawToken),
      groupId: GROUP_ID,
      role: 'member' as const,
      usedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60),
    };

    it('should create the Keycloak account and join the group together', async () => {
      mockInvites.findOneBy.mockResolvedValue(validInvite);
      mockKeycloakAdmin.createUser.mockResolvedValue('new-keycloak-sub');
      mockInvites.update.mockResolvedValue({ affected: 1 });
      mockMembers.create.mockImplementation((entity) => entity);

      const result = await service.registerAndAcceptInvite(rawToken, dto);

      expect(mockKeycloakAdmin.createUser).toHaveBeenCalledWith({
        email: dto.email,
        username: undefined,
        firstName: undefined,
        lastName: undefined,
        password: dto.password,
      });
      expect(mockMembers.create).toHaveBeenCalledWith({
        userId: 'new-keycloak-sub',
        groupId: GROUP_ID,
        role: 'member',
      });
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'group.member_registered', actorId: 'new-keycloak-sub' }),
      );
      expect(result).toEqual({ groupId: GROUP_ID, role: 'member' });
    });

    it('should delete the just-created Keycloak account if redeeming fails afterwards', async () => {
      mockInvites.findOneBy.mockResolvedValue(validInvite);
      mockKeycloakAdmin.createUser.mockResolvedValue('new-keycloak-sub');
      // Simulate the DB write failing after the Keycloak account already exists.
      mockInvites.update.mockRejectedValue(new Error('db unavailable'));
      mockKeycloakAdmin.deleteUser.mockResolvedValue(undefined);

      await expect(service.registerAndAcceptInvite(rawToken, dto)).rejects.toThrow(
        'db unavailable',
      );

      // The compensating cleanup ran, targeting the exact account just created.
      expect(mockKeycloakAdmin.deleteUser).toHaveBeenCalledWith('new-keycloak-sub');
    });

    it('should still surface the original error if the compensating cleanup itself fails', async () => {
      mockInvites.findOneBy.mockResolvedValue(validInvite);
      mockKeycloakAdmin.createUser.mockResolvedValue('new-keycloak-sub');
      mockInvites.update.mockRejectedValue(new Error('db unavailable'));
      mockKeycloakAdmin.deleteUser.mockRejectedValue(new Error('keycloak also down'));

      // Not 'keycloak also down' — the original failure is what the caller
      // needs to see; the cleanup failure is logged, not surfaced.
      await expect(service.registerAndAcceptInvite(rawToken, dto)).rejects.toThrow(
        'db unavailable',
      );
    });

    it('should re-validate the invite and never call Keycloak if it is already expired', async () => {
      mockInvites.findOneBy.mockResolvedValue({
        ...validInvite,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.registerAndAcceptInvite(rawToken, dto)).rejects.toThrow(GoneException);
      expect(mockKeycloakAdmin.createUser).not.toHaveBeenCalled();
    });

    it('should reject registration with neither a username nor an email', async () => {
      mockInvites.findOneBy.mockResolvedValue(validInvite);

      await expect(
        service.registerAndAcceptInvite(rawToken, { password: 'hunter2222' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockKeycloakAdmin.createUser).not.toHaveBeenCalled();
    });

    it('should accept registration with a username alone, no email', async () => {
      mockInvites.findOneBy.mockResolvedValue(validInvite);
      mockKeycloakAdmin.createUser.mockResolvedValue('new-keycloak-sub');
      mockInvites.update.mockResolvedValue({ affected: 1 });
      mockMembers.create.mockImplementation((entity) => entity);

      await service.registerAndAcceptInvite(rawToken, {
        username: 'newperson',
        password: 'hunter2222',
      });

      expect(mockKeycloakAdmin.createUser).toHaveBeenCalledWith({
        email: undefined,
        username: 'newperson',
        firstName: undefined,
        lastName: undefined,
        password: 'hunter2222',
      });
    });
  });
});
