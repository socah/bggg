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
import { HttpException } from '@nestjs/common';
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

    try {
      const userId = await keycloakAdmin.createUser({
        email,
        displayName: 'Admin',
        password,
      });

      console.log(`Created bootstrap account for ${email} (Keycloak sub: ${userId}).`);
      console.log('Log in at the web app and create your first group from there —');
      console.log('every subsequent user should arrive through an invite, not this script.');
    } catch (err) {
      // Running this script again against an environment that already has
      // the account (e.g. re-seeding without wiping Keycloak) is the normal
      // case, not a failure — only createUser's own 409 means that;
      // anything else is a real problem and still needs to fail loudly.
      if (err instanceof HttpException && err.getStatus() === 409) {
        console.log(`Account ${email} already exists — nothing to do.`);
        return;
      }
      throw err;
    }
  } finally {
    await appContext.close();
  }
}

main().catch((err) => {
  console.error('seed-admin failed:', err);
  process.exit(1);
});
