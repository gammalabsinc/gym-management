import "reflect-metadata";
import { DataSource, type DataSourceOptions } from "typeorm";
import { MIGRATIONS } from "./migrations";

/** The schema changes through reviewed migrations only. synchronize is never on. */
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: "postgres",
    url,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: "migrations",
    migrations: MIGRATIONS,
    entities: [],
    logging: false,
  };
}

/**
 * One data source per connection string. The role is chosen by the URL: the app role for the
 * server, the migrator role for the migrate mode.
 */
export function makeDataSource(url: string): DataSource {
  return new DataSource(dataSourceOptions(url));
}
