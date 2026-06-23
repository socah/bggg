import { Injectable, NotFoundException } from '@nestjs/common';

// Describes the shape of a group record. This will become a TypeORM entity
// in the next topic — for now it is a plain interface.
export interface Group {
  id: number;
  name: string;
  description: string;
}

// Describes the data a caller must provide to create a group.
// Using a separate type (not the full Group) means callers cannot accidentally
// pass an id — the service assigns that.
export interface CreateGroupDto {
  name: string;
  description: string;
}

// Patch requests only send the fields being changed, so every field is optional.
export interface UpdateGroupDto {
  name?: string;
  description?: string;
}

@Injectable()
export class GroupsService {
  // In-memory store — replaced by a TypeORM repository in 2_typeorm_entities.
  // The counter simulates auto-increment primary keys.
  private readonly groups: Group[] = [
    { id: 1, name: 'Tuesday Night Gamers', description: 'We meet every Tuesday at 7pm.' },
    { id: 2, name: 'Weekend Warriors', description: 'Long games, long weekends.' },
  ];
  private nextId = 3;

  findAll(): Group[] {
    return this.groups;
  }

  findOne(id: number): Group {
    const group = this.groups.find((g) => g.id === id);
    // NotFoundException maps to HTTP 404 automatically — NestJS reads the
    // exception class and sets the response status code.
    if (!group) throw new NotFoundException(`Group ${id} not found`);
    return group;
  }

  create(dto: CreateGroupDto): Group {
    const group: Group = { id: this.nextId++, ...dto };
    this.groups.push(group);
    return group;
  }

  update(id: number, dto: UpdateGroupDto): Group {
    const group = this.findOne(id); // reuses the 404 logic above
    // Object.assign mutates `group` in place — fine for an in-memory store.
    // TypeORM's save() will replace this pattern entirely next topic.
    Object.assign(group, dto);
    return group;
  }

  remove(id: number): void {
    const index = this.groups.findIndex((g) => g.id === id);
    if (index === -1) throw new NotFoundException(`Group ${id} not found`);
    this.groups.splice(index, 1);
  }
}
