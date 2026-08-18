import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { databaseConnectionOptions } from './config/database.config';

// A standalone DataSource for the TypeORM CLI — migration:generate/run/revert
// all need one of these, and it has to exist outside Nest's DI container
// (AppModule's TypeOrmModule.forRoot() only runs once Nest itself boots).
//
// entities/migrations use __dirname-relative globs, not a fixed 'src' or
// 'dist' path, so the exact same file works two ways: run via
// typeorm-ts-node-commonjs against this .ts file directly in dev
// (__dirname resolves under src/), and run via plain node against the
// compiled apps/api/dist/data-source.js in the production image, which has
// no ts-node or devDependencies at all (__dirname then resolves under
// dist/, picking up the compiled .js entities/migrations instead).
export const AppDataSource = new DataSource({
  ...databaseConnectionOptions(),
  entities: [`${__dirname}/**/*.entity{.ts,.js}`],
  migrations: [`${__dirname}/migrations/*{.ts,.js}`],
  // Never true here either — see app.module.ts's own comment. The CLI's
  // job is exactly to replace what synchronize would have done, safely.
  synchronize: false,
});
