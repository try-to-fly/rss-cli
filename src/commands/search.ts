import { Command } from 'commander';
import chalk from 'chalk';
import { cacheService } from '../services/cache.js';
import { logger } from '../utils/logger.js';
import type { ArticleWithFeed, ArticleWithTags } from '../models/article.js';

function formatArticle(article: ArticleWithFeed | ArticleWithTags, showContent = false): void {
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

  // 显示标签
  if ('tags' in article && article.tags && article.tags.length > 0) {
    const tagNames = article.tags.map(t => chalk.cyan(`#${t.name}`)).join(' ');
    console.log(`       ${chalk.gray('标签:')} ${tagNames}`);
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
    .description('按关键词搜索文章')
    .argument('<keyword>', '搜索关键词')
    .option('-i, --in <field>', '搜索范围: title, content 或 all', 'all')
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
    .description('以表格或 JSON 格式查看文章摘要')
    .option('-d, --days <n>', '显示最近 N 天的文章', '30')
    .option('-l, --limit <n>', '限制文章数量', '20')
    .option('-a, --all', '显示所有已分析的文章（不仅是有趣的）')
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
    .description('显示文章列表')
    .option('-f, --feed <id>', '按订阅源 ID 筛选')
    .option('-u, --unread', '仅显示未读文章')
    .option('-i, --interesting', '仅显示有趣的文章')
    .option('-n, --not-interesting', '仅显示不感兴趣的文章')
    .option('-d, --days <n>', '显示最近 N 天的文章')
    .option('-l, --limit <n>', '限制文章数量', '50')
    .option('-t, --tag <tags>', '按标签筛选（逗号分隔）')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const tags = options.tag ? options.tag.split(',').map((t: string) => t.trim()) : undefined;

      const articles = cacheService.getArticlesWithTags({
        feedId: options.feed ? parseInt(options.feed, 10) : undefined,
        unread: options.unread,
        interesting: options.interesting ? true : options.notInteresting ? false : undefined,
        days: options.days ? parseInt(options.days, 10) : undefined,
        limit: parseInt(options.limit, 10),
        tags,
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
