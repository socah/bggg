import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KeycloakAdminClient } from './keycloak-admin.client';

// Mirrors BggModule's shape: HttpModule registers HttpService for this
// module's scope, KeycloakAdminClient is the only provider, exported so
// InvitesModule (and the seed-admin script's application context) can use it.
@Module({
  imports: [HttpModule.register({ timeout: 10_000 })],
  providers: [KeycloakAdminClient],
  exports: [KeycloakAdminClient],
})
export class KeycloakModule {}
