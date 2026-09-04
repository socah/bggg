import { Module } from '@nestjs/common';
import { KeycloakModule } from '../keycloak/keycloak.module';
import { UsersController } from './users.controller';

@Module({
  imports: [KeycloakModule],
  controllers: [UsersController],
})
export class UsersModule {}
