import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { llmService } from '../services/llm.js';
import { cacheService } from '../services/cache.js';
import { logger } from '../utils/logger.js';

export function createSummaryCommand(): Command {
  const summary = new Command('analyze')
    .description('使用 LLM 分析文章（过滤和生成摘要）')
    .option('-f, --feed <id>', '分析指定 ID 的订阅源')
    .option('-d, --days <n>', '分析最近 N 天的文章', '7')
    .option('-s, --summary', '为有趣的文章生成摘要')
    .option('-b, --batch <n>', 'LLM 调用的批次大小', '10')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Analyzing articles...').start();

      try {
        const feedId = options.feed ? parseInt(options.feed, 10) : undefined;
        const days = parseInt(options.days, 10);
        const batchSize = parseInt(options.batch, 10);
        const withSummary = options.summary || false;

        // Get unanalyzed articles
        const articles = cacheService.getUnanalyzedArticles(feedId, days);

        if (articles.length === 0) {
          spinner.info('No unanalyzed articles found');
          if (options.json) {
            console.log(JSON.stringify({ analyzed: 0, interesting: 0, results: [] }));
          }
          return;
        }

        spinner.text = `Analyzing ${articles.length} articles...`;

        const allResults: { articleId: number; isInteresting: boolean; reason: string; summary?: string }[] = [];
        let interestingCount = 0;

        // Process in batches
        for (let i = 0; i < articles.length; i += batchSize) {
          const batch = articles.slice(i, i + batchSize);
          spinner.text = `Analyzing articles ${i + 1}-${Math.min(i + batchSize, articles.length)} of ${articles.length}...`;

          const results = await llmService.analyzeArticles(batch, withSummary);
          allResults.push(...results);
          interestingCount += results.filter((r) => r.isInteresting).length;
        }

        spinner.succeed('Analysis complete');

        if (options.json) {
          console.log(
            JSON.stringify({
              analyzed: articles.length,
              interesting: interestingCount,
              results: allResults,
            })
          );
          return;
        }

        console.log();
        console.log(chalk.bold('Analysis Results:'));
        console.log();
        console.log(`  Total analyzed: ${chalk.cyan(articles.length)}`);
        console.log(`  Interesting:    ${chalk.green(interestingCount)}`);
        console.log(`  Not interesting: ${chalk.dim(articles.length - interestingCount)}`);
        console.log();

        // Show interesting articles
        const interesting = allResults.filter((r) => r.isInteresting);
        if (interesting.length > 0) {
          console.log(chalk.yellow('Interesting articles:'));
          console.log();

          for (const result of interesting) {
            const article = articles.find((a) => a.id === result.articleId);
            if (!article) continue;

            console.log(`  ${chalk.green('►')} ${article.title}`);
            console.log(`    ${chalk.dim(result.reason)}`);
            if (result.summary) {
              console.log(`    ${chalk.blue('摘要:')} ${result.summary.slice(0, 100)}...`);
            }
            console.log();
          }
        }
      } catch (error) {
        spinner.fail('Analysis failed');
        if (options.json) {
          console.log(JSON.stringify({ error: (error as Error).message }));
        } else {
          logger.error((error as Error).message);
        }
      }
    });

  return summary;
}
