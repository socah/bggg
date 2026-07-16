import { readFileSync } from 'fs';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupsModule } from './groups/groups.module';
import { GamesModule } from './games/games.module';
import { AuditModule } from './audit/audit.module';
import { ChatModule } from './chat/chat.module';
import { UploadsModule } from './uploads/uploads.module';
import { InvitesModule } from './invites/invites.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { CalendarModule } from './calendar/calendar.module';

// Mirrors Postgres's own '_FILE' convention (see the 'db' service in
// docker-compose.dev.yml): prefer a secret mounted as a file over a plain
// env var. A value read into memory here never becomes part of this
// process's environment table, so it can't leak via 'docker inspect',
// '/proc/1/environ', or crash-reporting tools that dump process.env on an
// uncaught exception — all real exposure paths a plain DB_PASSWORD var
// would have. DB_PASSWORD itself still works for local/dev use.
function readDbPassword(): string | undefined {
  const passwordFile = process.env.DB_PASSWORD_FILE;
  return passwordFile ? readFileSync(passwordFile, 'utf8').trim() : process.env.DB_PASSWORD;
}

// AppModule is the root of the dependency graph. NestFactory starts here.
// Every feature module must be listed in `imports` for its routes and
// providers to be registered. As we add more features (games, sessions,
// invites), they each get their own module imported here.
@Module({
  imports: [
    // TypeOrmModule.forRoot() configures the single shared database connection
    // for the entire application. There is only ever one forRoot() call —
    // feature modules use forFeature() to register their specific entities.
    TypeOrmModule.forRoot({
      type: 'postgres', // tells TypeORM which driver to use (delegates to the 'pg' package)

      // Credentials come from environment variables, never hardcoded.
      // In Docker Compose the host is the service name 'db'; outside Docker it is 'localhost'.
      host: process.env.DB_HOST ?? 'localhost',
      port: parseInt(process.env.DB_PORT ?? '5432', 10),
      username: process.env.DB_USER,
      password: readDbPassword(),
      database: process.env.DB_NAME,

      // autoLoadEntities: true → TypeORM automatically registers every entity
      // that any feature module declares via TypeOrmModule.forFeature([...]).
      // Without this we would need to list every entity here manually.
      autoLoadEntities: true,

      // synchronize: false → TypeORM will NOT auto-alter the database schema
      // on startup. We use migration files instead (generated in the next step).
      // Never set this to true in production — a bad decorator change could
      // silently drop a column.
      synchronize: false,
    }),

    AuditModule,
    GroupsModule,
    GamesModule,
    ChatModule,
    UploadsModule,
    InvitesModule,
    SchedulingModule,
    CalendarModule,
  ],
})
export class AppModule {}
