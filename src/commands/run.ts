import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { rssService } from '../services/rss.js';
import { llmService } from '../services/llm.js';
import { cacheService } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../utils/config.js';
import { CONFIG_KEYS } from '../models/config.js';

export function createRunCommand(): Command {
  const run = new Command('run')
    .description('Update feeds, analyze articles, and show interesting ones')
    .option('-d, --days <n>', 'Analyze articles from last N days', '3')
    .option('-s, --summary', 'Generate summaries for interesting articles')
    .option('--skip-update', 'Skip feed update')
    .option('--skip-analyze', 'Skip LLM analysis')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const results: {
        updated?: Record<string, { newCount: number; error?: string }>;
        analyzed?: { total: number; interesting: number };
        articles?: unknown[];
      } = {};

      try {
        // Step 1: Update feeds
        if (!options.skipUpdate) {
          const spinner = ora('Updating feeds...').start();
          const updateResults = await rssService.updateAllFeeds();

          let totalNew = 0;
          const updateOutput: Record<string, { newCount: number; error?: string }> = {};

          for (const [name, result] of updateResults) {
            updateOutput[name] = result;
            totalNew += result.newCount;
          }

          results.updated = updateOutput;
          spinner.succeed(`Feeds updated: ${totalNew} new articles`);
        }

        // Step 2: Analyze with LLM (if configured)
        if (!options.skipAnalyze) {
          const hasLlmKey = getConfig(CONFIG_KEYS.LLM_API_KEY);

          if (hasLlmKey) {
            const spinner = ora('Analyzing articles with LLM...').start();
            const days = parseInt(options.days, 10);
            const articles = cacheService.getUnanalyzedArticles(undefined, days);

            if (articles.length > 0) {
              const analysisResults = await llmService.analyzeArticles(articles, options.summary);
              const interestingCount = analysisResults.filter((r) => r.isInteresting).length;

              results.analyzed = {
                total: articles.length,
                interesting: interestingCount,
              };

              spinner.succeed(`Analyzed ${articles.length} articles: ${interestingCount} interesting`);
            } else {
              spinner.info('No unanalyzed articles found');
              results.analyzed = { total: 0, interesting: 0 };
            }
          } else {
            if (!options.json) {
              logger.warn('LLM not configured. Skipping analysis. Use: rss config set llm_api_key <key>');
            }
          }
        }

        // Step 3: Show interesting articles
        const days = parseInt(options.days, 10);
        const interestingArticles = cacheService.getArticles({
          interesting: true,
          days,
          limit: 20,
        });

        results.articles = interestingArticles;

        if (options.json) {
          console.log(JSON.stringify(results));
          return;
        }

        // Display interesting articles
        console.log();
        console.log(chalk.bold.yellow('═══════════════════════════════════════════════════════════════'));
        console.log(chalk.bold.yellow('                     Interesting Articles                       '));
        console.log(chalk.bold.yellow('═══════════════════════════════════════════════════════════════'));
        console.log();

        if (interestingArticles.length === 0) {
          logger.info('No interesting articles found');
          return;
        }

        for (const article of interestingArticles) {
          const date = article.pub_date
            ? new Date(article.pub_date).toLocaleDateString()
            : 'Unknown';

          console.log(chalk.green('►') + ' ' + chalk.bold(article.title));
          console.log(`  ${chalk.dim(`[${article.feed_name}]`)} ${chalk.dim(date)}`);

          if (article.link) {
            console.log(`  ${chalk.blue(article.link)}`);
          }

          if (article.interest_reason) {
            console.log(`  ${chalk.yellow('为什么有趣:')} ${article.interest_reason}`);
          }

          if (article.summary) {
            console.log(`  ${chalk.cyan('摘要:')} ${article.summary}`);
          }

          console.log();
        }

        console.log(chalk.dim(`共 ${interestingArticles.length} 篇有趣的文章`));
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: (error as Error).message }));
        } else {
          logger.error((error as Error).message);
        }
      }
    });

  return run;
}
