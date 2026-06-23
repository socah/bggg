import { Module } from '@nestjs/common';
import { GroupsModule } from './groups/groups.module';

// AppModule is the root of the dependency graph. NestFactory starts here.
// Every feature module must be listed in `imports` for its routes and
// providers to be registered. As we add more features (games, sessions,
// invites), they each get their own module imported here.
@Module({
  imports: [
    GroupsModule,
    // TypeOrmModule.forRoot(...) goes here in the next topic (2_typeorm_entities)
    // when we wire up the real PostgreSQL connection.
  ],
})
export class AppModule {}
