import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import ora from 'ora';
import {
  PERIOD_DAYS,
  generateReportData,
  generateMarkdown,
  formatDate,
} from './report.js';

const STATE_DIR = join(homedir(), '.rss-cli');
const REPORTS_DIR = join(STATE_DIR, 'reports');
const STATE_FILE = join(STATE_DIR, 'report-cron-state.json');

interface ReportHistoryItem {
  reportPath: string;
  period: string;
  days: number;
  generatedAt: string;
  articlesCount: number;
}

interface ReportCronState {
  lastRunAt: string | null;
  lastRunResult: {
    success: boolean;
    reportPath: string;
    period: string;
    days: number;
    articlesCount: number;
    generatedAt: string;
    error?: string;
  } | null;
  history: ReportHistoryItem[];
}

function loadState(): ReportCronState {
  if (!existsSync(STATE_FILE)) {
    return { lastRunAt: null, lastRunResult: null, history: [] };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { lastRunAt: null, lastRunResult: null, history: [] };
  }
}

function saveState(state: ReportCronState): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function shouldRun(state: ReportCronState, intervalHours: number): boolean {
  if (!state.lastRunAt) return true;
  const lastRun = new Date(state.lastRunAt);
  const now = new Date();
  const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastRun >= intervalHours;
}

function getPeriodName(period: string, days: number): string {
  if (PERIOD_DAYS[period]) {
    return period;
  }
  return `custom_${days}d`;
}

function getReportFileName(period: string, days: number): string {
  const date = formatDate(new Date());
  const periodName = getPeriodName(period, days);
  return `${date}_${periodName}.md`;
}

export function createReportCronCommand(): Command {
  const reportCron = new Command('report-cron')
    .summary('定时生成报告命令，用于 crontab 自动化调度')
    .description(`定时生成报告命令，用于 crontab 自动化调度。

用途说明:
  定期生成 RSS 技术周报/日报/月报，保存到 ~/.rss-cli/reports/ 目录。
  专为无人值守的定时任务设计。

执行流程:
  1. 检查距离上次运行是否已达到最小间隔时间
  2. 调用 report 生成逻辑，生成 Markdown 报告
  3. 保存报告到 ~/.rss-cli/reports/ 目录
  4. 更新状态文件 ~/.rss-cli/report-cron-state.json

输出格式 (--quiet 模式):
  JSON 对象，包含以下字段:
  - success: 是否成功（布尔值）
  - reportPath: 生成的报告文件路径
  - period: 报告周期
  - articlesCount: 文章数量
  - error: 错误信息（如果有）

使用示例:
  rss report-cron                    # 生成周报（默认）
  rss report-cron -p day             # 生成日报
  rss report-cron -p month           # 生成月报
  rss report-cron -d 14              # 自定义14天报告
  rss report-cron --force --quiet    # 强制执行，仅输出 JSON
  0 0 * * 0 rss report-cron --quiet >> ~/.rss-cli/report-cron.log 2>&1`)
    .option('-p, --period <period>', '预设时间范围: day(1天), week(7天), month(30天)', 'week')
    .option('-d, --days <n>', '自定义天数（覆盖 --period 设置）')
    .option('-i, --interval <hours>', '最小运行间隔（小时），未达间隔则跳过执行', '24')
    .option('--force', '忽略间隔检查，强制执行')
    .option('--quiet', '静默模式：不显示进度，仅输出最终 JSON 结果')
    .option('--no-resources', '不包含热门资源章节')
    .option('--history-limit <n>', '历史记录保留条数', '50')
    .action(async (options) => {
      const quiet = options.quiet;
      const intervalHours = parseFloat(options.interval);
      const period = options.period;
      const days = options.days ? parseInt(options.days, 10) : (PERIOD_DAYS[period] || 7);
      const historyLimit = parseInt(options.historyLimit, 10);

      const state = loadState();

      // Check interval
      if (!options.force && !shouldRun(state, intervalHours)) {
        const result = {
          skipped: true,
          reason: 'interval_not_reached',
          lastRunAt: state.lastRunAt,
          intervalHours,
        };
        if (quiet) {
          console.log(JSON.stringify(result));
        } else {
          console.log(`跳过执行: 上次运行于 ${state.lastRunAt}，间隔 ${intervalHours} 小时未到`);
        }
        return;
      }

      const result = {
        success: true,
        reportPath: '',
        period: getPeriodName(period, days),
        days,
        articlesCount: 0,
        generatedAt: new Date().toISOString(),
        error: undefined as string | undefined,
      };

      try {
        // Ensure reports directory exists
        if (!existsSync(REPORTS_DIR)) {
          mkdirSync(REPORTS_DIR, { recursive: true });
        }

        const spinner = quiet ? null : ora('生成报告中...').start();

        // Generate report data
        const { data: reportData } = await generateReportData({
          days,
          includeResources: options.resources !== false,
          onProgress: (msg) => {
            if (spinner) spinner.text = msg;
          },
        });

        result.articlesCount = reportData.articles.length;

        // Generate markdown
        const markdown = generateMarkdown(reportData);

        // Save report file
        const fileName = getReportFileName(period, days);
        const reportPath = join(REPORTS_DIR, fileName);
        writeFileSync(reportPath, markdown, 'utf-8');
        result.reportPath = reportPath;

        spinner?.succeed(`报告已生成: ${reportPath}`);

        // Update state
        const historyItem: ReportHistoryItem = {
          reportPath,
          period: result.period,
          days,
          generatedAt: result.generatedAt,
          articlesCount: result.articlesCount,
        };

        const newHistory = [historyItem, ...state.history].slice(0, historyLimit);

        const newState: ReportCronState = {
          lastRunAt: new Date().toISOString(),
          lastRunResult: {
            success: true,
            reportPath,
            period: result.period,
            days,
            articlesCount: result.articlesCount,
            generatedAt: result.generatedAt,
          },
          history: newHistory,
        };
        saveState(newState);

        if (quiet) {
          console.log(JSON.stringify(result));
        }
      } catch (error) {
        result.success = false;
        result.error = (error as Error).message;

        // Update state with error
        const newState: ReportCronState = {
          lastRunAt: new Date().toISOString(),
          lastRunResult: {
            success: false,
            reportPath: '',
            period: result.period,
            days,
            articlesCount: 0,
            generatedAt: result.generatedAt,
            error: result.error,
          },
          history: state.history,
        };
        saveState(newState);

        if (quiet) {
          console.log(JSON.stringify(result));
        } else {
          console.error('错误:', (error as Error).message);
        }
        process.exit(1);
      }
    });

  return reportCron;
}

export { STATE_FILE, REPORTS_DIR, loadState, ReportCronState, ReportHistoryItem };
