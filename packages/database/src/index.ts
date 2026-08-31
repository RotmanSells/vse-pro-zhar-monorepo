export {
  createDatabaseClient,
  type DatabaseClient
} from "./db.js";
export {
  DatabaseConfigError,
  formatDatabaseFailure,
  loadDatabaseConfig,
  DatabaseConfigSchema,
  type DatabaseConfig,
  type DatabaseOperation,
  type ConfigDiagnostic
} from "./config/env.js";
export { migrateDatabase, migrationsFolder } from "./migrate.js";
export {
  createCatalogRepository,
  type CatalogCategoryInput,
  type CatalogCategoryUpdate,
  type CatalogProductInput,
  type CatalogProductUpdate,
  type CatalogRepository,
  type CatalogSnapshot
} from "./catalog-repository.js";
export {
  categories,
  products,
  type CategoryRecord,
  type ProductRecord
} from "./schema.js";
