import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { rssService } from '../services/rss.js';
import { cacheService } from '../services/cache.js';
import { exportRecentArticles, EXPORTS_DIR } from '../services/export.js';
import { logger } from '../utils/logger.js';

export function createUpdateCommand(): Command {
  const update = new Command('update')
    .description('Fetch updates from RSS feeds')
    .option('-f, --feed <id>', 'Update specific feed by ID')
    .option('-a, --all', 'Update all feeds')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      const spinner = ora('Fetching updates...').start();

      try {
        const feedId = options.feed ? parseInt(options.feed, 10) : undefined;

        if (feedId) {
          const feed = cacheService.getFeedById(feedId);
          if (!feed) {
            spinner.fail(`Feed with ID ${feedId} not found`);
            return;
          }
        }

        const results = await rssService.updateAllFeeds(feedId);

        spinner.stop();

        if (options.json) {
          const output: Record<string, { newCount: number; error?: string }> = {};
          for (const [name, result] of results) {
            output[name] = result;
          }
          console.log(JSON.stringify(output));
          return;
        }

        console.log();
        console.log(chalk.bold('Update Results:'));
        console.log();

        let totalNew = 0;
        let hasErrors = false;

        for (const [name, result] of results) {
          if (result.error) {
            console.log(`  ${chalk.red('✗')} ${name}: ${chalk.red(result.error)}`);
            hasErrors = true;
          } else {
            totalNew += result.newCount;
            const countText =
              result.newCount > 0
                ? chalk.green(`+${result.newCount} new`)
                : chalk.dim('no new articles');
            console.log(`  ${chalk.green('✓')} ${name}: ${countText}`);
          }
        }

        console.log();
        if (totalNew > 0) {
          logger.success(`Total: ${totalNew} new articles`);

          // 导出文章数据
          const exportSpinner = ora('Exporting articles...').start();
          const exportCount = exportRecentArticles(7);
          exportSpinner.succeed(`Exported ${exportCount} articles to ${EXPORTS_DIR}`);
        } else {
          logger.info('No new articles found');
        }

        if (hasErrors) {
          logger.warn('Some feeds failed to update');
        }
      } catch (error) {
        spinner.fail('Update failed');
        if (options.json) {
          console.log(JSON.stringify({ error: (error as Error).message }));
        } else {
          logger.error((error as Error).message);
        }
      }
    });

  return update;
}
