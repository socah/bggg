import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const subscriptions = {
    upsert: jest.fn(),
    delete: jest.fn(),
    findBy: jest.fn(),
  };
  const preferences = {
    findOneBy: jest.fn(),
    findBy: jest.fn(),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const members = { findBy: jest.fn() };
  let service: NotificationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_SUBJECT;
    service = new NotificationsService(subscriptions as never, preferences as never, members as never);
  });

  it('uses privacy-preserving defaults when no preference row exists', async () => {
    preferences.findOneBy.mockResolvedValue(null);

    await expect(service.getPreferences('user-1')).resolves.toEqual({
      userId: 'user-1',
      chatMessages: true,
      proposalUpdates: true,
      showMessagePreviews: false,
    });
  });

  it('stores a browser subscription against the authenticated user', async () => {
    subscriptions.upsert.mockResolvedValue(undefined);

    await service.saveSubscription('user-1', {
      endpoint: 'https://push.example/subscription',
      p256dh: 'public-key',
      auth: 'auth-secret',
      expirationTime: 123,
    });

    expect(subscriptions.upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      expirationTime: '123',
    }), ['endpoint']);
  });

  it('does no delivery work when VAPID is not configured', async () => {
    await service.notifyProposalUpdate({
      id: 'proposal-1', groupId: 'group-1', proposedDate: '2026-09-10',
    }, 'actor-1', 'An RSVP changed');

    expect(subscriptions.findBy).not.toHaveBeenCalled();
  });
});
