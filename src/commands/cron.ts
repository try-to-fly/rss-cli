import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import ora from 'ora';
import { rssService } from '../services/rss.js';
import { llmService, type ProgressCallback } from '../services/llm.js';
import { cacheService } from '../services/cache.js';
import { exportAnalyzedArticles } from '../services/export.js';

const STATE_DIR = join(homedir(), '.rss-cli');
const STATE_FILE = join(STATE_DIR, 'cron-state.json');

interface CronState {
  lastRunAt: string | null;
  lastRunResult: {
    feedsUpdated: number;
    newArticles: number;
    articlesAnalyzed: number;
    interestingCount: number;
    exportedCount: number;
  } | null;
}

function loadState(): CronState {
  if (!existsSync(STATE_FILE)) {
    return { lastRunAt: null, lastRunResult: null };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return { lastRunAt: null, lastRunResult: null };
  }
}

function saveState(state: CronState): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function shouldRun(state: CronState, intervalHours: number): boolean {
  if (!state.lastRunAt) return true;
  const lastRun = new Date(state.lastRunAt);
  const now = new Date();
  const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
  return hoursSinceLastRun >= intervalHours;
}

export function createCronCommand(): Command {
  const cron = new Command('cron')
    .description(`定时任务命令，用于 crontab 自动化调度。

用途说明:
  执行完整的 RSS 工作流：更新订阅源 -> LLM 分析文章 -> 导出数据。
  专为无人值守的定时任务设计。

执行流程:
  1. 检查距离上次运行是否已达到最小间隔时间
  2. 更新所有 RSS 订阅源，获取新文章
  3. 使用 LLM 分析未处理的文章（过滤 + 生成摘要）
  4. 导出已分析的文章到 ~/.rss-cli/exports/
  5. 保存运行状态到 ~/.rss-cli/cron-state.json

输出格式 (--quiet 模式):
  JSON 对象，包含以下字段:
  - success: 是否成功（布尔值）
  - feedsUpdated: 处理的订阅源数量
  - newArticles: 获取的新文章数量
  - articlesAnalyzed: 分析的文章数量
  - interestingCount: 标记为有趣的文章数量
  - exportedCount: 导出的文章数量
  - errors: 错误信息数组

使用示例:
  rss cron                    # 使用默认配置（2小时间隔，分析3天内文章）
  rss cron --force --quiet    # 强制执行，仅输出 JSON
  rss cron -i 4 -d 7          # 4小时间隔，分析7天内文章
  0 */2 * * * rss cron --quiet >> ~/.rss-cli/cron.log 2>&1`)
    .option('-i, --interval <hours>', '最小运行间隔（小时），未达间隔则跳过执行', '2')
    .option('-d, --days <n>', '分析最近 N 天内发布的文章', '3')
    .option('-s, --summary', '为有趣的文章生成 LLM 摘要（默认开启）', true)
    .option('--no-summary', '跳过摘要生成，仅进行文章过滤')
    .option('--force', '忽略间隔检查，强制执行')
    .option('--quiet', '静默模式：不显示进度，仅输出最终 JSON 结果')
    .action(async (options) => {
      const quiet = options.quiet;
      const intervalHours = parseFloat(options.interval);
      const days = parseInt(options.days, 10);
      const withSummary = options.summary;

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
          console.log(`Skipped: last run at ${state.lastRunAt}, interval ${intervalHours}h not reached`);
        }
        return;
      }

      const result = {
        success: true,
        startedAt: new Date().toISOString(),
        feedsUpdated: 0,
        newArticles: 0,
        articlesAnalyzed: 0,
        interestingCount: 0,
        exportedCount: 0,
        errors: [] as string[],
      };

      try {
        // Step 1: Update all feeds
        const spinner = quiet ? null : ora('Updating feeds...').start();
        const updateResults = await rssService.updateAllFeeds();

        for (const [name, res] of updateResults) {
          result.feedsUpdated++;
          result.newArticles += res.newCount;
          if (res.error) {
            result.errors.push(`${name}: ${res.error}`);
          }
        }
        spinner?.succeed(`Updated ${result.feedsUpdated} feeds, ${result.newArticles} new articles`);

        // Step 2: Analyze articles with LLM
        const hasLlmKey = process.env.OPENAI_API_KEY;
        if (hasLlmKey) {
          const analyzeSpinner = quiet ? null : ora('Analyzing articles...').start();
          const articles = cacheService.getUnanalyzedArticles(undefined, days);

          if (articles.length > 0) {
            const onProgress: ProgressCallback = (progress) => {
              if (analyzeSpinner) {
                if (progress.phase === 'filter') {
                  analyzeSpinner.text = `Filtering articles... [${progress.tokens.totalTokens} tokens]`;
                } else {
                  analyzeSpinner.text = `Summarizing (${progress.current}/${progress.total}) [${progress.tokens.totalTokens} tokens]`;
                }
              }
            };

            const analysisResults = await llmService.analyzeArticles(articles, withSummary, onProgress);
            result.articlesAnalyzed = articles.length;
            result.interestingCount = analysisResults.filter(r => r.isInteresting).length;
            analyzeSpinner?.succeed(`Analyzed ${result.articlesAnalyzed} articles, ${result.interestingCount} interesting`);
          } else {
            analyzeSpinner?.info('No unanalyzed articles');
          }
        }

        // Step 3: Export analyzed articles
        const exportSpinner = quiet ? null : ora('Exporting...').start();
        result.exportedCount = exportAnalyzedArticles(days);
        exportSpinner?.succeed(`Exported ${result.exportedCount} articles`);

        // Save state
        const newState: CronState = {
          lastRunAt: new Date().toISOString(),
          lastRunResult: {
            feedsUpdated: result.feedsUpdated,
            newArticles: result.newArticles,
            articlesAnalyzed: result.articlesAnalyzed,
            interestingCount: result.interestingCount,
            exportedCount: result.exportedCount,
          },
        };
        saveState(newState);

        if (quiet) {
          console.log(JSON.stringify(result));
        }
      } catch (error) {
        result.success = false;
        result.errors.push((error as Error).message);
        if (quiet) {
          console.log(JSON.stringify(result));
        } else {
          console.error('Error:', (error as Error).message);
        }
        process.exit(1);
      }
    });

  return cron;
}
