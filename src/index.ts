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

// 核心工作流
program.addCommand(createRunCommand());
program.addCommand(createUpdateCommand());
program.addCommand(createSummaryCommand());

// 浏览查询
program.addCommand(createShowCommand());
program.addCommand(createSearchCommand());
program.addCommand(createDigestCommand());

// 报告系统
program.addCommand(createReportCommand());
program.addCommand(createReportCronCommand());
program.addCommand(createReportListCommand());

// 管理配置
program.addCommand(createFeedCommand());
program.addCommand(createConfigCommand());
program.addCommand(createPrefCommand());

// 数据探索
program.addCommand(createResourceCommand());
program.addCommand(createTagCommand());

// 诊断维护
program.addCommand(createStatusCommand());
program.addCommand(createAnalyzeReportCommand());
program.addCommand(createResetCommand());

// 自动化
program.addCommand(createCronCommand());

program.addHelpText('after', `
命令分类:
  核心工作流    run, update, analyze
  浏览查询      show, search, digest
  报告系统      report, report-cron, report-list
  管理配置      feed, config, pref
  数据探索      resource, tag
  诊断维护      status, analyze-report, reset
  自动化        cron
`);

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
