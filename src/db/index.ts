import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { SCHEMA } from './schema.js';

const DATA_DIR = join(homedir(), '.rss-cli');
const DB_PATH = join(DATA_DIR, 'rss.db');

let db: Database.Database | null = null;

function runMigrations(database: Database.Database): void {
  // 检查 articles 表是否有 text_snapshot 字段
  const columns = database.prepare("PRAGMA table_info(articles)").all() as { name: string }[];
  const columnNames = columns.map(c => c.name);

  if (!columnNames.includes('text_snapshot')) {
    database.exec('ALTER TABLE articles ADD COLUMN text_snapshot TEXT');
    database.exec('ALTER TABLE articles ADD COLUMN snapshot_at DATETIME');
    console.log('[DB] Migration: Added text_snapshot and snapshot_at columns to articles table');
  }
}

export function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);
    runMigrations(db);
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export { DB_PATH, DATA_DIR };
