import { Command } from 'commander';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import {
  STATE_FILE,
  REPORTS_DIR,
  loadState,
  type ReportCronState,
  type ReportHistoryItem,
} from './report-cron.js';
import { generateReportData, generateMarkdown, formatDate } from './report.js';

interface ReportInfo {
  name: string;
  path: string;
  period: string;
  date: string;
  size: number;
  modifiedAt: string;
}

function parseReportName(fileName: string): { date: string; period: string } | null {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})_(.+)\.md$/);
  if (!match) return null;
  return { date: match[1], period: match[2] };
}

function getReportList(limit: number, periodFilter?: string): ReportInfo[] {
  if (!existsSync(REPORTS_DIR)) {
    return [];
  }

  const files = readdirSync(REPORTS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const parsed = parseReportName(f);
      if (!parsed) return null;

      const filePath = join(REPORTS_DIR, f);
      const stat = statSync(filePath);

      return {
        name: f.replace('.md', ''),
        path: filePath,
        period: parsed.period,
        date: parsed.date,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .filter((r): r is ReportInfo => r !== null);

  // Filter by period if specified
  let filtered = files;
  if (periodFilter) {
    filtered = files.filter(r => r.period === periodFilter || r.period.startsWith(periodFilter));
  }

  // Sort by date descending
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  return filtered.slice(0, limit);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getPeriodLabel(period: string): string {
  const labels: Record<string, string> = {
    day: '日报',
    week: '周报',
    month: '月报',
  };
  if (labels[period]) return labels[period];
  const match = period.match(/^custom_(\d+)d$/);
  if (match) return `${match[1]}天报告`;
  return period;
}

export function createReportListCommand(): Command {
  const reportList = new Command('report-list')
    .summary('查看已生成的报告列表')
    .description(`查看已生成的报告列表。

用途说明:
  列出 ~/.rss-cli/reports/ 目录下的所有报告文件，
  支持按时间、周期筛选，支持查看报告详情。

使用示例:
  rss report-list                    # 列出所有报告
  rss report-list -n 10              # 列出最近 10 个报告
  rss report-list -p week            # 只显示周报
  rss report-list --show 2025-02-06_week  # 查看指定报告内容
  rss report-list --open 2025-02-06_week  # 用默认编辑器打开报告
  rss report-list --json             # JSON 格式输出
  rss report-list --status           # 显示 report-cron 的运行状态`)
    .option('-n, --limit <n>', '显示最近 N 个报告', '20')
    .option('-p, --period <period>', '按周期筛选: day, week, month')
    .option('--show <name>', '显示指定报告的内容（不含 .md 后缀）')
    .option('--open <name>', '用默认编辑器打开指定报告')
    .option('--path <name>', '输出指定报告的完整路径')
    .option('--json', '输出 JSON 格式')
    .option('--status', '显示 report-cron 的运行状态')
    .option('--latest', '输出最新报告的内容')
    .action(async (options) => {
      // Show latest report content (generate day report in real-time)
      if (options.latest) {
        const { data } = await generateReportData({ days: 1 });
        const content = generateMarkdown(data);
        if (content) {
          // Save to reports directory
          if (!existsSync(REPORTS_DIR)) {
            mkdirSync(REPORTS_DIR, { recursive: true });
          }
          const fileName = `${formatDate(new Date())}_day.md`;
          const filePath = join(REPORTS_DIR, fileName);
          writeFileSync(filePath, content, 'utf-8');
          console.log(content);
        }
        return;
      }

      // Show status
      if (options.status) {
        const state = loadState();
        if (options.json) {
          console.log(JSON.stringify(state, null, 2));
        } else {
          console.log(chalk.bold('Report Cron 状态'));
          console.log('─'.repeat(40));
          if (state.lastRunAt) {
            console.log(`上次运行: ${state.lastRunAt}`);
          } else {
            console.log('上次运行: 从未运行');
          }
          if (state.lastRunResult) {
            const r = state.lastRunResult;
            console.log(`运行结果: ${r.success ? chalk.green('成功') : chalk.red('失败')}`);
            if (r.success) {
              console.log(`报告路径: ${r.reportPath}`);
              console.log(`报告周期: ${getPeriodLabel(r.period)} (${r.days}天)`);
              console.log(`文章数量: ${r.articlesCount}`);
            } else if (r.error) {
              console.log(`错误信息: ${chalk.red(r.error)}`);
            }
          }
          console.log(`历史记录: ${state.history.length} 条`);
        }
        return;
      }

      // Show specific report content
      if (options.show) {
        const reportPath = join(REPORTS_DIR, `${options.show}.md`);
        if (!existsSync(reportPath)) {
          console.error(chalk.red(`报告不存在: ${options.show}`));
          process.exit(1);
        }
        const content = readFileSync(reportPath, 'utf-8');
        console.log(content);
        return;
      }

      // Open specific report
      if (options.open) {
        const reportPath = join(REPORTS_DIR, `${options.open}.md`);
        if (!existsSync(reportPath)) {
          console.error(chalk.red(`报告不存在: ${options.open}`));
          process.exit(1);
        }
        try {
          const cmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';
          execSync(`${cmd} "${reportPath}"`);
          console.log(`已打开: ${reportPath}`);
        } catch (err) {
          console.error('无法打开文件:', (err as Error).message);
          process.exit(1);
        }
        return;
      }

      // Output path
      if (options.path) {
        const reportPath = join(REPORTS_DIR, `${options.path}.md`);
        if (!existsSync(reportPath)) {
          console.error(chalk.red(`报告不存在: ${options.path}`));
          process.exit(1);
        }
        console.log(reportPath);
        return;
      }

      // List reports
      const limit = parseInt(options.limit, 10);
      const reports = getReportList(limit, options.period);

      if (reports.length === 0) {
        if (options.json) {
          console.log(JSON.stringify([]));
        } else {
          console.log('暂无报告。使用 `rss report-cron` 生成报告。');
        }
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(reports, null, 2));
      } else {
        console.log(chalk.bold('已生成的报告'));
        console.log('─'.repeat(60));
        console.log(
          chalk.gray('名称'.padEnd(25)) +
          chalk.gray('周期'.padEnd(12)) +
          chalk.gray('大小'.padEnd(10)) +
          chalk.gray('日期')
        );
        console.log('─'.repeat(60));

        for (const report of reports) {
          console.log(
            report.name.padEnd(25) +
            getPeriodLabel(report.period).padEnd(12) +
            formatSize(report.size).padEnd(10) +
            report.date
          );
        }

        console.log('─'.repeat(60));
        console.log(chalk.gray(`共 ${reports.length} 个报告`));
        console.log(chalk.gray('使用 --show <name> 查看报告内容'));
      }
    });

  return reportList;
}
