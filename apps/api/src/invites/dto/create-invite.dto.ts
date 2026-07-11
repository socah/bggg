import { IsIn } from 'class-validator';
import { InviteRole } from '../invite.entity';

export class CreateInviteDto {
  // 'owner' is excluded at the TypeScript type level by InviteRole, but a
  // raw JSON body isn't checked against TS types at all — ValidationPipe
  // needs this explicit runtime list to actually reject { "role": "owner" }
  // with a 400 instead of letting it slip into the database.
  @IsIn(['admin', 'member'])
  role!: InviteRole;
}
