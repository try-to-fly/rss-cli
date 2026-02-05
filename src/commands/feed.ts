import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { cacheService } from '../services/cache.js';
import { rssService } from '../services/rss.js';
import { logger } from '../utils/logger.js';
import type { Feed } from '../models/feed.js';

export function createFeedCommand(): Command {
  const feed = new Command('feed').description('Manage RSS feeds');

  feed
    .command('add')
    .description('Add a new RSS feed')
    .argument('<url>', 'Feed URL')
    .option('-n, --name <name>', 'Feed name (auto-detected if not provided)')
    .option('-c, --category <category>', 'Feed category')
    .option('-p, --proxy <mode>', 'Proxy mode: auto, direct, or proxy', 'auto')
    .option('--json', 'Output as JSON')
    .action(async (url: string, options) => {
      const spinner = ora('Adding feed...').start();

      try {
        // Check if feed already exists
        const existing = cacheService.getFeedByUrl(url);
        if (existing) {
          spinner.fail('Feed already exists');
          if (options.json) {
            console.log(JSON.stringify({ error: 'Feed already exists', feed: existing }));
          } else {
            logger.warn(`Feed already exists: ${existing.name} (id: ${existing.id})`);
          }
          return;
        }

        // Auto-detect feed name if not provided
        let name = options.name;
        if (!name) {
          spinner.text = 'Detecting feed info...';
          const info = await rssService.detectFeedInfo(url);
          name = info?.title || new URL(url).hostname;
        }

        const feed = cacheService.addFeed({
          name,
          url,
          category: options.category,
          proxy_mode: options.proxy as 'auto' | 'direct' | 'proxy',
        });

        spinner.succeed('Feed added successfully');

        if (options.json) {
          console.log(JSON.stringify(feed));
        } else {
          console.log();
          console.log(chalk.green('Feed added:'));
          console.log(`  ID:       ${chalk.cyan(feed.id)}`);
          console.log(`  Name:     ${feed.name}`);
          console.log(`  URL:      ${chalk.dim(feed.url)}`);
          if (feed.category) {
            console.log(`  Category: ${feed.category}`);
          }
          console.log(`  Proxy:    ${feed.proxy_mode}`);
        }
      } catch (error) {
        spinner.fail('Failed to add feed');
        if (options.json) {
          console.log(JSON.stringify({ error: (error as Error).message }));
        } else {
          logger.error((error as Error).message);
        }
      }
    });

  feed
    .command('remove')
    .description('Remove an RSS feed')
    .argument('<id-or-url>', 'Feed ID or URL')
    .option('--json', 'Output as JSON')
    .action((idOrUrl: string, options) => {
      const success = cacheService.removeFeed(idOrUrl);

      if (options.json) {
        console.log(JSON.stringify({ success }));
      } else if (success) {
        logger.success(`Feed removed: ${idOrUrl}`);
      } else {
        logger.error(`Feed not found: ${idOrUrl}`);
      }
    });

  feed
    .command('list')
    .description('List all RSS feeds')
    .option('-c, --category <category>', 'Filter by category')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const feeds = cacheService.getAllFeeds(options.category);

      if (options.json) {
        console.log(JSON.stringify(feeds));
        return;
      }

      if (feeds.length === 0) {
        logger.info('No feeds found. Use "rss feed add <url>" to add one.');
        return;
      }

      console.log();
      console.log(chalk.bold(`RSS Feeds (${feeds.length}):`));
      console.log();

      // Group by category
      const byCategory = new Map<string, Feed[]>();
      for (const feed of feeds) {
        const cat = feed.category || 'Uncategorized';
        if (!byCategory.has(cat)) {
          byCategory.set(cat, []);
        }
        byCategory.get(cat)!.push(feed);
      }

      for (const [category, categoryFeeds] of byCategory) {
        console.log(chalk.yellow(`[${category}]`));
        for (const f of categoryFeeds) {
          const lastFetch = f.last_fetched_at
            ? new Date(f.last_fetched_at).toLocaleString()
            : 'Never';
          console.log(
            `  ${chalk.cyan(f.id.toString().padStart(3))} ${f.name.padEnd(30)} ${chalk.dim(`(${f.proxy_mode})`)}`
          );
          console.log(`      ${chalk.dim(f.url)}`);
          console.log(`      Last fetch: ${chalk.dim(lastFetch)}`);
        }
        console.log();
      }
    });

  return feed;
}
