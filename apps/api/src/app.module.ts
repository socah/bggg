import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConnectionOptions } from './config/database.config';
import { GroupsModule } from './groups/groups.module';
import { GamesModule } from './games/games.module';
import { AuditModule } from './audit/audit.module';
import { ChatModule } from './chat/chat.module';
import { UploadsModule } from './uploads/uploads.module';
import { InvitesModule } from './invites/invites.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { CalendarModule } from './calendar/calendar.module';
import { CollectionsModule } from './collections/collections.module';
import { UsersModule } from './users/users.module';
import { SessionsModule } from './sessions/sessions.module';

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
      // Credentials come from environment variables, never hardcoded — see
      // database.config.ts, shared with data-source.ts (the TypeORM CLI's
      // own connection, used to run migrations) so the two can't drift.
      ...databaseConnectionOptions(),

      // autoLoadEntities: true → TypeORM automatically registers every entity
      // that any feature module declares via TypeOrmModule.forFeature([...]).
      // Without this we would need to list every entity here manually.
      autoLoadEntities: true,

      // synchronize: false → TypeORM will NOT auto-alter the database schema
      // on startup. We use migration files instead (see src/migrations/ and
      // data-source.ts). Never set this to true in production — a bad
      // decorator change could silently drop a column.
      synchronize: false,
    }),

    AuditModule,
    GroupsModule,
    GamesModule,
    CollectionsModule,
    ChatModule,
    UploadsModule,
    InvitesModule,
    SchedulingModule,
    SessionsModule,
    CalendarModule,
    UsersModule,
  ],
})
export class AppModule {}
