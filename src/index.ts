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
import { createReportCronCommand } from './commands/report-cron.js';
import { createReportListCommand } from './commands/report-list.js';
import { createAnalyzeReportCommand } from './commands/analyze-report.js';
import { createStatusCommand } from './commands/status.js';
import { createResetCommand } from './commands/reset.js';
import { closeDb } from './db/index.js';

const program = new Command();

program
  .name('rss')
  .description('功能丰富的 RSS 订阅管理命令行工具')
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
program.addCommand(createReportCronCommand());
program.addCommand(createReportListCommand());
program.addCommand(createAnalyzeReportCommand());
program.addCommand(createStatusCommand());
program.addCommand(createResetCommand());

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
