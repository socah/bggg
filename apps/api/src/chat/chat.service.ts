import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Message } from './message.entity';
import { GroupsService } from '../groups/groups.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messageRepository: Repository<Message>,
    // Injecting GroupsService (not GroupRepository directly) means the
    // ownership check below is the EXACT same check GroupsController uses —
    // one place decides "does this user have access to this group", reused
    // here instead of re-implemented. If group membership ever expands
    // beyond ownerId (Phase 3: invite_system), fixing GroupsService.findOne
    // automatically fixes chat access too.
    private readonly groupsService: GroupsService,
  ) {}

  async saveMessage(
    groupId: string,
    senderId: string,
    body: string,
  ): Promise<Message> {
    // Throws NotFoundException or ForbiddenException if senderId does not
    // own groupId — this is the authorization check the gateway relies on
    // before ever touching socket.join() or broadcasting anything.
    await this.groupsService.findOne(groupId, senderId);

    const message = this.messageRepository.create({ groupId, senderId, body });
    return this.messageRepository.save(message);
  }

  async getHistory(groupId: string, requestingUserId: string): Promise<Message[]> {
    await this.groupsService.findOne(groupId, requestingUserId);

    return this.messageRepository.find({
      where: { groupId },
      order: { createdAt: 'ASC' },
    });
  }
}
