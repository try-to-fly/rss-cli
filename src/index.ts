#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { createFeedCommand } from './commands/feed.js';
import { createUpdateCommand } from './commands/update.js';
import { createSummaryCommand } from './commands/summary.js';
import { createSearchCommand, createShowCommand, createDigestCommand } from './commands/search.js';
import { createConfigCommand, createPrefCommand } from './commands/config.js';
import { createRunCommand } from './commands/run.js';
import { createResourceCommand } from './commands/resource.js';
import { createTagCommand } from './commands/tag.js';
import { createCronCommand } from './commands/cron.js';
import { createReportCommand } from './commands/report.js';
import { closeDb } from './db/index.js';

const program = new Command();

program
  .name('rss')
  .description('A feature-rich RSS subscription management CLI tool')
  .version('1.0.0');

// Register commands
program.addCommand(createFeedCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createSummaryCommand());
program.addCommand(createSearchCommand());
program.addCommand(createShowCommand());
program.addCommand(createDigestCommand());
program.addCommand(createConfigCommand());
program.addCommand(createPrefCommand());
program.addCommand(createRunCommand());
program.addCommand(createResourceCommand());
program.addCommand(createTagCommand());
program.addCommand(createCronCommand());
program.addCommand(createReportCommand());

// Handle errors
program.exitOverride();

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if ((error as Error).name !== 'CommanderError') {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
} finally {
  closeDb();
}
