import { defineConfig } from 'drizzle-kit';
import { homedir } from 'os';
import { join } from 'path';

const DATA_DIR = join(homedir(), '.rss-cli');
const DB_PATH = join(DATA_DIR, 'rss.db');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: DB_PATH,
  },
});
