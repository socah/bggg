import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  threadId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  @Matches(/\S/, { message: 'body must contain a visible character' })
  body!: string;
}
