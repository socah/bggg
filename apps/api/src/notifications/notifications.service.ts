import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import webPush from 'web-push';
import { GroupMember } from '../groups/group-member.entity';
import type { ChatThread } from '../chat/chat-thread.entity';
import type { PlaySessionProposal } from '../scheduling/play-session-proposal.entity';
import { NotificationPreferences } from './notification-preferences.entity';
import { PushSubscriptionRecord } from './push-subscription.entity';
import type { SavePushSubscriptionDto } from './dto/save-push-subscription.dto';
import type { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

type Category = 'chatMessages' | 'proposalUpdates';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly configured: boolean;

  constructor(
    @InjectRepository(PushSubscriptionRecord)
    private readonly subscriptions: Repository<PushSubscriptionRecord>,
    @InjectRepository(NotificationPreferences)
    private readonly preferences: Repository<NotificationPreferences>,
    @InjectRepository(GroupMember)
    private readonly members: Repository<GroupMember>,
  ) {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    this.configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT);
    if (this.configured) {
      webPush.setVapidDetails(VAPID_SUBJECT!, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
    } else {
      this.logger.warn('Web push is disabled because VAPID configuration is incomplete');
    }
  }

  getConfiguration() {
    return { enabled: this.configured, publicKey: this.configured ? process.env.VAPID_PUBLIC_KEY : null };
  }

  async getPreferences(userId: string) {
    const stored = await this.preferences.findOneBy({ userId });
    return stored ?? { userId, chatMessages: true, proposalUpdates: true, showMessagePreviews: false };
  }

  async updatePreferences(userId: string, updates: UpdateNotificationPreferencesDto) {
    const current = await this.getPreferences(userId);
    return this.preferences.save(this.preferences.create({ ...current, ...updates, userId }));
  }

  async saveSubscription(userId: string, dto: SavePushSubscriptionDto): Promise<void> {
    await this.subscriptions.upsert({
      userId,
      endpoint: dto.endpoint,
      p256dh: dto.p256dh,
      auth: dto.auth,
      expirationTime: dto.expirationTime == null ? null : String(dto.expirationTime),
    }, ['endpoint']);
  }

  async removeSubscription(userId: string, endpoint: string): Promise<void> {
    await this.subscriptions.delete({ userId, endpoint });
  }

  async notifyChatMessage(thread: ChatThread, senderId: string, body: string): Promise<void> {
    if (!this.configured) return;
    try {
      const recipientIds = thread.kind === 'direct'
        ? [thread.directUserA, thread.directUserB].filter((id): id is string => Boolean(id && id !== senderId))
        : (await this.members.findBy({ groupId: thread.groupId! }))
            .map((member) => member.userId)
            .filter((id) => id !== senderId);
      if (recipientIds.length === 0) return;

      await this.deliver(recipientIds, 'chatMessages', (preference) => ({
        title: 'New chat message',
        body: preference.showMessagePreviews ? body.slice(0, 140) : 'Open BGGG to read it.',
        tag: `chat-${thread.id}`,
        url: thread.groupId ? `/groups/${thread.groupId}/chat` : '/chat',
      }));
    } catch (error) {
      this.logger.error({ msg: 'chat_notification_failed', threadId: thread.id, error });
    }
  }

  async notifyProposalUpdate(
    proposal: Pick<PlaySessionProposal, 'id' | 'groupId' | 'proposedDate'>,
    actorId: string,
    message: string,
  ): Promise<void> {
    if (!this.configured) return;
    try {
      const recipientIds = (await this.members.findBy({ groupId: proposal.groupId }))
        .map((member) => member.userId)
        .filter((id) => id !== actorId);
      await this.deliver(recipientIds, 'proposalUpdates', () => ({
        title: 'Proposal updated',
        body: `${message} (${proposal.proposedDate})`,
        tag: `proposal-${proposal.id}`,
        url: `/groups/${proposal.groupId}/calendar`,
      }));
    } catch (error) {
      this.logger.error({ msg: 'proposal_notification_failed', proposalId: proposal.id, error });
    }
  }

  private async deliver(
    recipientIds: string[],
    category: Category,
    payloadFor: (preference: NotificationPreferences) => Record<string, string>,
  ): Promise<void> {
    if (!this.configured || recipientIds.length === 0) return;
    try {
      const [subscriptions, storedPreferences] = await Promise.all([
        this.subscriptions.findBy({ userId: In(recipientIds) }),
        this.preferences.findBy({ userId: In(recipientIds) }),
      ]);
      const preferencesByUser = new Map(storedPreferences.map((row) => [row.userId, row]));
      await Promise.all(subscriptions.map(async (subscription) => {
        const preference = preferencesByUser.get(subscription.userId)
          ?? this.preferences.create({ userId: subscription.userId, chatMessages: true, proposalUpdates: true, showMessagePreviews: false });
        if (!preference[category]) return;
        try {
          await webPush.sendNotification({
            endpoint: subscription.endpoint,
            expirationTime: subscription.expirationTime ? Number(subscription.expirationTime) : null,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify(payloadFor(preference)));
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            await this.subscriptions.delete(subscription.id);
          } else {
            this.logger.error({ msg: 'push_delivery_failed', subscriptionId: subscription.id, statusCode });
          }
        }
      }));
    } catch (error) {
      this.logger.error({ msg: 'notification_dispatch_failed', error });
    }
  }
}
