import { Command } from 'commander';
import chalk from 'chalk';
import { cacheService } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import type { ArticleWithFeed } from '../models/article.js';

function formatArticle(article: ArticleWithFeed, showContent = false): void {
  const date = article.pub_date
    ? new Date(article.pub_date).toLocaleDateString()
    : 'Unknown date';

  let status = '';
  if (article.is_interesting === 1) {
    status = chalk.green(' ★');
  } else if (article.is_interesting === 0) {
    status = chalk.dim(' ○');
  }

  console.log(`  ${chalk.cyan(article.id.toString().padStart(4))} ${article.title}${status}`);
  console.log(`       ${chalk.dim(`[${article.feed_name}]`)} ${chalk.dim(date)}`);

  if (article.link) {
    console.log(`       ${chalk.blue(article.link)}`);
  }

  if (article.interest_reason) {
    console.log(`       ${chalk.yellow('理由:')} ${article.interest_reason}`);
  }

  if (article.summary) {
    console.log(`       ${chalk.blue('摘要:')} ${article.summary}`);
  }

  if (showContent && article.content) {
    const preview = article.content
      .replace(/<[^>]*>/g, '')
      .slice(0, 200)
      .trim();
    console.log(`       ${chalk.dim(preview)}...`);
  }

  console.log();
}

export function createSearchCommand(): Command {
  const search = new Command('search')
    .description('Search articles by keyword')
    .argument('<keyword>', 'Search keyword')
    .option('-i, --in <field>', 'Search in: title, content, or all', 'all')
    .option('--json', 'Output as JSON')
    .action((keyword: string, options) => {
      const searchIn = options.in as 'title' | 'content' | 'all';
      const articles = cacheService.searchArticles(keyword, searchIn);

      if (options.json) {
        console.log(JSON.stringify(articles));
        return;
      }

      if (articles.length === 0) {
        logger.info(`No articles found matching "${keyword}"`);
        return;
      }

      console.log();
      console.log(chalk.bold(`Search Results for "${keyword}" (${articles.length}):`));
      console.log();

      for (const article of articles) {
        formatArticle(article, true);
      }
    });

  return search;
}

export function createDigestCommand(): Command {
  const digest = new Command('digest')
    .description('View article summaries in table or JSON format')
    .option('-d, --days <n>', 'Show articles from last N days', '30')
    .option('-l, --limit <n>', 'Limit number of articles', '20')
    .option('-a, --all', 'Show all analyzed articles (not just interesting)')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const articles = cacheService.getArticles({
        interesting: options.all ? undefined : true,
        days: parseInt(options.days, 10),
        limit: parseInt(options.limit, 10),
      }).filter(a => a.summary);

      if (options.json) {
        const data = articles.map(a => ({
          id: a.id,
          title: a.title,
          date: a.pub_date,
          feed: a.feed_name,
          link: a.link,
          interesting: a.is_interesting === 1,
          reason: a.interest_reason,
          summary: a.summary,
        }));
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      if (articles.length === 0) {
        logger.info('No articles with summaries found');
        return;
      }

      // Table output
      const colWidths = { id: 4, date: 10, title: 40 };
      const separator = '-'.repeat(colWidths.id + colWidths.date + colWidths.title + 10);

      console.log();
      console.log(chalk.bold(`Article Digests (${articles.length}):`));
      console.log();
      console.log(chalk.dim(separator));
      console.log(
        chalk.bold(
          `${'ID'.padEnd(colWidths.id)} | ${'Date'.padEnd(colWidths.date)} | Title`
        )
      );
      console.log(chalk.dim(separator));

      for (const article of articles) {
        const date = article.pub_date
          ? new Date(article.pub_date).toLocaleDateString()
          : 'N/A';
        const title = article.title.length > colWidths.title
          ? article.title.slice(0, colWidths.title - 3) + '...'
          : article.title;
        const star = article.is_interesting === 1 ? chalk.green('★') : chalk.dim('○');

        console.log(
          `${chalk.cyan(article.id.toString().padEnd(colWidths.id))} | ${date.padEnd(colWidths.date)} | ${title} ${star}`
        );
        console.log(chalk.dim(`     ${article.link}`));
        if (article.interest_reason) {
          console.log(chalk.yellow(`     理由: ${article.interest_reason}`));
        }
        if (article.summary) {
          console.log(chalk.blue(`     摘要: ${article.summary}`));
        }
        console.log(chalk.dim(separator));
      }
    });

  return digest;
}

export function createShowCommand(): Command {
  const show = new Command('show')
    .description('Show articles')
    .option('-f, --feed <id>', 'Filter by feed ID')
    .option('-u, --unread', 'Show only unread articles')
    .option('-i, --interesting', 'Show only interesting articles')
    .option('-n, --not-interesting', 'Show only not interesting articles')
    .option('-d, --days <n>', 'Show articles from last N days')
    .option('-l, --limit <n>', 'Limit number of articles', '50')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const articles = cacheService.getArticles({
        feedId: options.feed ? parseInt(options.feed, 10) : undefined,
        unread: options.unread,
        interesting: options.interesting ? true : options.notInteresting ? false : undefined,
        days: options.days ? parseInt(options.days, 10) : undefined,
        limit: parseInt(options.limit, 10),
      });

      if (options.json) {
        console.log(JSON.stringify(articles));
        return;
      }

      if (articles.length === 0) {
        logger.info('No articles found matching criteria');
        return;
      }

      console.log();
      console.log(chalk.bold(`Articles (${articles.length}):`));
      console.log();

      for (const article of articles) {
        formatArticle(article);
      }
    });

  return show;
}
