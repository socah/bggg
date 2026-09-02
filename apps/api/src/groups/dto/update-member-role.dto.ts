import { IsIn } from 'class-validator';
import { GroupRole } from '../group-member.entity';

export class UpdateMemberRoleDto {
  @IsIn(['admin', 'member'])
  role!: Exclude<GroupRole, 'owner'>;
}
