import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { KeycloakAdminClient } from '../keycloak/keycloak-admin.client';

interface AccountDeletionJob {
  subject_id: string;
  tombstone: string;
  identity_deleted: boolean;
  created_at: Date | string;
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);
  private readonly scheduledJobs = new Set<string>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly keycloakAdmin: KeycloakAdminClient,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const jobs = await this.dataSource.query<AccountDeletionJob[]>(`SELECT subject_id, tombstone, identity_deleted, created_at FROM account_deletion_jobs`);
    for (const job of jobs) {
      void this.processJob(job);
    }
  }

  async deleteAccount(userId: string): Promise<void> {
    const tombstone = `deleted:${randomUUID()}`;
    const subjectHash = createHash('sha256').update(userId).digest('hex');

    // The marker and durable job commit together, so blocking the account
    // always leaves enough information to resume deletion after a failure.
    const job = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO deleted_account_subjects (subject_hash) VALUES ($1) ON CONFLICT DO NOTHING`,
        [subjectHash],
      );
      await manager.query(
        `INSERT INTO account_deletion_jobs (subject_id, tombstone) VALUES ($1, $2) ON CONFLICT (subject_id) DO NOTHING`,
        [userId, tombstone],
      );
      const [stored] = await manager.query<AccountDeletionJob[]>(
        `SELECT subject_id, tombstone, identity_deleted, created_at FROM account_deletion_jobs WHERE subject_id = $1`,
        [userId],
      );
      return stored ?? { subject_id: userId, tombstone, identity_deleted: false, created_at: new Date() };
    });
    await this.processJob(job);
  }

  private async completeDeletion(job: AccountDeletionJob): Promise<void> {
    if (!job.identity_deleted) {
      await this.keycloakAdmin.deleteUser(job.subject_id);
      await this.dataSource.query(`UPDATE account_deletion_jobs SET identity_deleted = true WHERE subject_id = $1`, [job.subject_id]);
    }
    await this.cleanupData(job.subject_id, job.tombstone);
  }

  private async processJob(job: AccountDeletionJob): Promise<void> {
    try {
      await this.completeDeletion(job);
    } catch (error) {
      this.logger.error({ msg: 'account_deletion_retry_failed', userId: job.subject_id, error });
    }
    this.scheduleReconciliation(job.subject_id);
  }

  private async cleanupData(userId: string, tombstone: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.transferOwnedGroups(manager, userId, tombstone);

      // Direct messages and personal data are private account state, not
      // shared play history, so they can be removed outright.
      await manager.query(
        `DELETE FROM global_direct_message_origins WHERE thread_id IN (SELECT thread_id FROM global_direct_thread_origins WHERE direct_user_a = $1 OR direct_user_b = $1)`,
        [userId],
      );
      await manager.query(
        `DELETE FROM global_direct_thread_origins WHERE direct_user_a = $1 OR direct_user_b = $1`,
        [userId],
      );
      await manager.query(
        `DELETE FROM chat_threads WHERE kind = 'direct' AND (direct_user_a = $1 OR direct_user_b = $1)`,
        [userId],
      );
      for (const table of [
        'calendar_feed_tokens', 'chat_thread_dismissals', 'bgg_accounts',
        'game_ownership', 'game_wishlist', 'game_saved', 'reviews', 'personal_lists',
        'play_session_proposal_rsvps', 'play_session_proposal_game_votes',
        'proposal_place_votes', 'place_owners', 'place_visibility',
      ]) {
        await manager.query(`DELETE FROM ${table} WHERE user_id = $1`, [userId]);
      }
      await manager.query(`DELETE FROM invites WHERE created_by = $1 AND used_at IS NULL`, [userId]);
      await manager.query(`DELETE FROM group_members WHERE user_id = $1`, [userId]);

      // Shared and historical rows remain, but no longer point at the deleted
      // Keycloak subject. This preserves sessions and logged-play history.
      await this.tombstone(manager, 'play_session_proposals', 'created_by', userId, tombstone);
      await this.tombstone(manager, 'play_session_proposals', 'host_id', userId, tombstone);
      await this.tombstone(manager, 'play_session_proposal_games', 'proposed_by', userId, tombstone);
      await this.tombstone(manager, 'proposal_places', 'proposed_by', userId, tombstone);
      await this.tombstone(manager, 'places', 'created_by', userId, tombstone);
      await this.tombstone(manager, 'play_session_hosts', 'user_id', userId, tombstone);
      await this.tombstone(manager, 'messages', 'sender_id', userId, tombstone);
      await this.tombstone(manager, 'legacy_orphaned_messages', 'sender_id', userId, tombstone);
      await this.tombstone(manager, 'play_photos', 'uploaded_by', userId, tombstone);
      await this.tombstone(manager, 'invites', 'created_by', userId, tombstone);
      await this.tombstone(manager, 'invites', 'used_by', userId, tombstone);

      // Legacy play result/player rows reference this integer user record.
      // Anonymize it in place rather than deleting it and triggering cascades.
      await manager.query(
        `UPDATE users SET keycloak_sub = $2, display_name = 'Deleted user', avatar_url = NULL, bgg_username = NULL WHERE keycloak_sub = $1`,
        [userId, tombstone],
      );
    });
  }

  private scheduleReconciliation(userId: string): void {
    if (this.scheduledJobs.has(userId)) return;
    this.scheduledJobs.add(userId);
    const timer = setTimeout(() => {
      this.scheduledJobs.delete(userId);
      void this.reconcile(userId);
    }, 10_000);
    timer.unref();
  }

  private async reconcile(userId: string): Promise<void> {
    try {
      const [job] = await this.dataSource.query<AccountDeletionJob[]>(
        `SELECT subject_id, tombstone, identity_deleted, created_at FROM account_deletion_jobs WHERE subject_id = $1`,
        [userId],
      );
      if (!job) return;
      if (!job.identity_deleted) {
        await this.processJob(job);
        return;
      }
      await this.cleanupData(job.subject_id, job.tombstone);
      if (Date.now() - new Date(job.created_at).getTime() >= 5 * 60_000) {
        await this.dataSource.query(`DELETE FROM account_deletion_jobs WHERE subject_id = $1`, [job.subject_id]);
      } else {
        this.scheduleReconciliation(job.subject_id);
      }
    } catch (error) {
      this.logger.error({ msg: 'account_deletion_reconciliation_failed', userId, error });
      this.scheduleReconciliation(userId);
    }
  }

  private async transferOwnedGroups(manager: EntityManager, userId: string, tombstone: string) {
    const groups = await manager.query<Array<{ id: string; is_solo: boolean }>>(
      `SELECT id, is_solo FROM groups WHERE owner_id = $1 FOR UPDATE`,
      [userId],
    );
    for (const group of groups) {
      const [successor] = await manager.query<Array<{ user_id: string }>>(
        `SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2 ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, joined_at, id LIMIT 1`,
        [group.id, userId],
      );
      const ownerId = !group.is_solo && successor ? successor.user_id : tombstone;
      await manager.query(`UPDATE groups SET owner_id = $2 WHERE id = $1`, [group.id, ownerId]);
      if (successor && !group.is_solo) {
        await manager.query(`UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2`, [group.id, successor.user_id]);
      }
    }
  }

  private tombstone(manager: EntityManager, table: string, column: string, userId: string, tombstone: string) {
    return manager.query(`UPDATE ${table} SET ${column} = $2 WHERE ${column} = $1`, [userId, tombstone]);
  }
}
