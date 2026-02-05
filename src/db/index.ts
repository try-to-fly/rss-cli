import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import * as schema from './schema.js';

export const DATA_DIR = join(homedir(), '.rss-cli');
export const DB_PATH = join(DATA_DIR, 'rss.db');

let sqlite: Database.Database | null = null;
let drizzleDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function initializeDatabase(): Database.Database {
  ensureDataDir();
  const database = new Database(DB_PATH);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  return database;
}

export function getDb(): ReturnType<typeof drizzle<typeof schema>> {
  if (!drizzleDb) {
    sqlite = initializeDatabase();
    drizzleDb = drizzle(sqlite, { schema });
  }
  return drizzleDb;
}

export function getSqlite(): Database.Database {
  if (!sqlite) {
    sqlite = initializeDatabase();
    drizzleDb = drizzle(sqlite, { schema });
  }
  return sqlite;
}

export function closeDb(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    drizzleDb = null;
  }
}

export { schema };
