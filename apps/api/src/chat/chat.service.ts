import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, type FindOptionsWhere } from 'typeorm';
import { Message } from './message.entity';
import { GroupsService } from '../groups/groups.service';
import { ChatThread } from './chat-thread.entity';
import { PlaySessionProposal } from '../scheduling/play-session-proposal.entity';
import { ChatThreadDismissal } from './chat-thread-dismissal.entity';

export interface ChatThreadSummary extends ChatThread {
  lastMessage: Message | null;
}

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    @InjectRepository(ChatThread)
    private readonly threadRepository: Repository<ChatThread>,
    @InjectRepository(ChatThreadDismissal)
    private readonly dismissalRepository: Repository<ChatThreadDismissal>,
    @InjectRepository(PlaySessionProposal)
    private readonly proposalRepository: Repository<PlaySessionProposal>,
    private readonly groupsService: GroupsService,
  ) {}

  async listThreads(groupId: string, requestingUserId: string): Promise<ChatThreadSummary[]> {
    await this.groupsService.findOne(groupId, requestingUserId);
    await this.getOrCreateThread({ groupId, kind: 'general' });

    const proposals = await this.proposalRepository.findBy({ groupId });
    await Promise.all(
      proposals.map((proposal) =>
        this.getOrCreateThread({ groupId, kind: 'proposal', proposalId: proposal.id }),
      ),
    );

    const visibleThreadFilters: FindOptionsWhere<ChatThread>[] = [{ groupId, kind: 'general' }];
    if (proposals.length > 0) {
      visibleThreadFilters.push({
        groupId,
        kind: 'proposal',
        proposalId: In(proposals.map((proposal) => proposal.id)),
      });
    }
    const threads = await this.threadRepository.find({
      where: visibleThreadFilters,
      order: { updatedAt: 'DESC' },
    });
    return Promise.all(
      threads.map(async (thread) => ({
        ...thread,
        lastMessage: await this.messageRepository.findOne({
          where: { threadId: thread.id },
          order: { createdAt: 'DESC' },
        }),
      })),
    );
  }

  async listDirectThreads(requestingUserId: string): Promise<ChatThreadSummary[]> {
    const threads = await this.threadRepository
      .createQueryBuilder('thread')
      .where('thread.kind = :kind', { kind: 'direct' })
      .andWhere('(thread.direct_user_a = :userId OR thread.direct_user_b = :userId)', {
        userId: requestingUserId,
      })
      .orderBy('thread.updated_at', 'DESC')
      .getMany();
    const dismissals = await this.dismissalRepository.findBy({ userId: requestingUserId });
    const dismissedIds = new Set(dismissals.map((dismissal) => dismissal.threadId));

    const accessible: ChatThread[] = [];
    for (const thread of threads) {
      if (dismissedIds.has(thread.id)) continue;
      const otherUserId = thread.directUserA === requestingUserId
        ? thread.directUserB
        : thread.directUserA;
      try {
        await this.groupsService.assertUsersShareGroup(requestingUserId, otherUserId!);
        accessible.push(thread);
      } catch (error) {
        // Threads are retained if membership changes, but hidden until the
        // participants share a group again.
        if (!(error instanceof ForbiddenException)) throw error;
      }
    }
    return Promise.all(accessible.map(async (thread) => ({
      ...thread,
      lastMessage: await this.messageRepository.findOne({
        where: { threadId: thread.id },
        order: { createdAt: 'DESC' },
      }),
    })));
  }

  async getOrCreateDirectThread(
    requestingUserId: string,
    otherUserId: string,
  ): Promise<ChatThread> {
    await this.groupsService.assertUsersShareGroup(requestingUserId, otherUserId);
    const [directUserA, directUserB] = [requestingUserId, otherUserId].sort();
    const thread = await this.getOrCreateThread({
      groupId: null,
      kind: 'direct',
      directUserA,
      directUserB,
    });
    await this.dismissalRepository.delete({ threadId: thread.id, userId: requestingUserId });
    return thread;
  }

  async removeDirectThread(threadId: string, requestingUserId: string): Promise<void> {
    const thread = await this.threadRepository.findOneBy({ id: threadId, kind: 'direct' });
    if (!thread) throw new NotFoundException('Direct chat not found');
    if (thread.directUserA !== requestingUserId && thread.directUserB !== requestingUserId) {
      throw new ForbiddenException('You do not have access to this direct chat');
    }
    await this.dismissalRepository.upsert(
      { threadId: thread.id, userId: requestingUserId },
      ['threadId', 'userId'],
    );
  }

  async getOrCreateProposalThread(
    groupId: string,
    proposalId: string,
    requestingUserId: string,
  ): Promise<ChatThread> {
    await this.groupsService.findOne(groupId, requestingUserId);
    const proposal = await this.proposalRepository.findOneBy({ id: proposalId, groupId });
    if (!proposal) throw new NotFoundException('Proposal not found in this group');
    return this.getOrCreateThread({ groupId, kind: 'proposal', proposalId });
  }

  async getHistory(threadId: string, requestingUserId: string): Promise<Message[]> {
    await this.getAuthorizedThread(threadId, requestingUserId);

    const messages = await this.messageRepository.find({
      where: { threadId },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return messages.reverse();
  }

  async saveMessage(threadId: string, senderId: string, body: string): Promise<Message> {
    await this.getAuthorizedThread(threadId, senderId);
    return this.messageRepository.manager.transaction(async (manager) => {
      const messages = manager.getRepository(Message);
      const threads = manager.getRepository(ChatThread);
      const message = await messages.save(
        messages.create({ threadId, senderId, body: body.trim() }),
      );
      await threads.update(threadId, { updatedAt: new Date() });
      return message;
    });
  }

  async canAccessThread(threadId: string, userId: string): Promise<boolean> {
    try {
      await this.getAuthorizedThread(threadId, userId);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException || error instanceof NotFoundException) {
        return false;
      }
      throw error;
    }
  }

  private async getAuthorizedThread(threadId: string, userId: string): Promise<ChatThread> {
    const thread = await this.threadRepository.findOneBy({ id: threadId });
    if (!thread) throw new NotFoundException('Chat not found');
    if (thread.kind === 'direct') {
      if (thread.directUserA !== userId && thread.directUserB !== userId) {
        throw new ForbiddenException('You do not have access to this direct chat');
      }
      const otherUserId = thread.directUserA === userId
        ? thread.directUserB
        : thread.directUserA;
      await this.groupsService.assertUsersShareGroup(userId, otherUserId!);
    } else {
      await this.groupsService.findOne(thread.groupId!, userId);
    }
    return thread;
  }

  private async getOrCreateThread(
    attributes: Pick<ChatThread, 'groupId' | 'kind'> &
      Partial<Pick<ChatThread, 'proposalId' | 'directUserA' | 'directUserB'>>,
  ): Promise<ChatThread> {
    const where: FindOptionsWhere<ChatThread> = {
      groupId: attributes.groupId ?? IsNull(),
      kind: attributes.kind,
      proposalId: attributes.proposalId ?? IsNull(),
      directUserA: attributes.directUserA ?? IsNull(),
      directUserB: attributes.directUserB ?? IsNull(),
    };
    const existing = await this.threadRepository.findOneBy(where);
    if (existing) return existing;

    try {
      return await this.threadRepository.save(this.threadRepository.create({
        groupId: attributes.groupId,
        kind: attributes.kind,
        proposalId: attributes.proposalId ?? null,
        directUserA: attributes.directUserA ?? null,
        directUserB: attributes.directUserB ?? null,
      }));
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505') {
        const raced = await this.threadRepository.findOneBy(where);
        if (raced) return raced;
      }
      throw error;
    }
  }
}
