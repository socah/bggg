import { readFileSync } from 'fs';
import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

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

// Shared by AppModule's TypeOrmModule.forRoot() (the running app) and
// data-source.ts (the TypeORM CLI, run outside Nest's DI container) so the
// two never connect to the database differently — the exact kind of drift
// that left prod on a schema the app's own migrations didn't expect.
export function databaseConnectionOptions(): Pick<
  PostgresDataSourceOptions,
  'type' | 'host' | 'port' | 'username' | 'password' | 'database'
> {
  return {
    type: 'postgres',
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER,
    password: readDbPassword(),
    database: process.env.DB_NAME,
  };
}
