// One-time bootstrap script — NOT part of the running application, never
// imported by src/. Run manually, once, per environment:
//   npm run seed:admin --workspace=apps/api
//
// Registration is invite-only (see notes/3_invite_system.md Decision 4),
// which means the very first account has no existing member to invite it.
// This script creates exactly that one account directly via the same
// Keycloak Admin API the real /invites/:token/register endpoint uses, from
// BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD. That person then logs
// in and creates their own first group — POST /groups was never
// invite-gated, only account creation was — and invites everyone else from
// inside the app from that point on.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { KeycloakModule } from '../src/keycloak/keycloak.module';
import { KeycloakAdminClient } from '../src/keycloak/keycloak-admin.client';

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL;
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must both be set',
    );
  }

  // createApplicationContext boots just enough of Nest's DI system to
  // resolve KeycloakAdminClient — no HTTP server, no controllers, and
  // crucially no TypeOrmModule.forRoot() from AppModule. This script never
  // touches Postgres at all; it only talks to Keycloak, so KeycloakModule
  // alone is the whole dependency graph it needs.
  const appContext = await NestFactory.createApplicationContext(KeycloakModule, {
    logger: false,
  });

  try {
    const keycloakAdmin = appContext.get(KeycloakAdminClient);

    const userId = await keycloakAdmin.createUser({
      email,
      displayName: 'Admin',
      password,
    });

    console.log(`Created bootstrap account for ${email} (Keycloak sub: ${userId}).`);
    console.log('Log in at the web app and create your first group from there —');
    console.log('every subsequent user should arrive through an invite, not this script.');
  } finally {
    await appContext.close();
  }
}

main().catch((err) => {
  console.error('seed-admin failed:', err);
  process.exit(1);
});
