import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CreateGroupDto {
  // @IsString + @IsNotEmpty together reject null, undefined, numbers, and
  // empty strings — ValidationPipe throws 400 before the handler is called.
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  // ! tells TypeScript this is always assigned before use — ValidationPipe
  // populates it from the request body, not a constructor.
  name!: string;
}
