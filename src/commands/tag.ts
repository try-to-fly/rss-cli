import { Command } from 'commander';
import chalk from 'chalk';
import { cacheService } from '../services/cache.js';
import type { TagWithCount } from '../models/tag.js';

function displayTag(tag: TagWithCount): void {
  const articleInfo = tag.article_count > 0
    ? chalk.blue(`${tag.article_count} 篇文章`)
    : chalk.gray('0 篇文章');
  const resourceInfo = tag.resource_count > 0
    ? chalk.green(`${tag.resource_count} 个资源`)
    : chalk.gray('0 个资源');

  console.log(
    `  ${chalk.cyan(`#${tag.name.padEnd(20)}`)} ${articleInfo} | ${resourceInfo}`
  );
}

export function createTagCommand(): Command {
  const tag = new Command('tag').description('标签管理');

  // list - 列出所有标签
  tag
    .command('list')
    .description('列出所有标签及统计')
    .option('-n, --limit <limit>', '显示数量', parseInt)
    .action((options) => {
      let tags = cacheService.getTagsWithCounts();

      if (options.limit) {
        tags = tags.slice(0, options.limit);
      }

      if (tags.length === 0) {
        console.log(chalk.yellow('暂无标签数据'));
        console.log(chalk.gray('提示: 运行 rss run -s 来分析文章并提取标签'));
        return;
      }

      console.log(chalk.bold.green('\n🏷️  标签列表\n'));

      for (const t of tags) {
        displayTag(t);
      }

      console.log(chalk.gray(`\n共 ${tags.length} 个标签`));
    });

  // search - 搜索标签
  tag
    .command('search <keyword>')
    .description('搜索标签')
    .action((keyword) => {
      const tags = cacheService.searchTags(keyword);

      if (tags.length === 0) {
        console.log(chalk.yellow(`未找到与 "${keyword}" 相关的标签`));
        return;
      }

      console.log(chalk.bold.green(`\n🔍 搜索结果: "${keyword}"\n`));

      for (const t of tags) {
        displayTag(t);
      }

      console.log(chalk.gray(`\n共 ${tags.length} 个结果`));
    });

  // articles - 查看标签下的文章
  tag
    .command('articles <tagName>')
    .description('查看标签下的文章')
    .option('-n, --limit <limit>', '显示数量', parseInt)
    .action((tagName, options) => {
      const tagInfo = cacheService.getTagByName(tagName);

      if (!tagInfo) {
        console.log(chalk.red(`标签 "${tagName}" 不存在`));
        return;
      }

      const articles = cacheService.getArticlesByTag(tagInfo.id, options.limit || 50);

      if (articles.length === 0) {
        console.log(chalk.yellow(`标签 "${tagName}" 下暂无文章`));
        return;
      }

      console.log(chalk.bold.green(`\n📰 标签 #${tagName} 下的文章\n`));

      for (const article of articles) {
        const date = article.pub_date
          ? new Date(article.pub_date).toLocaleDateString('zh-CN')
          : '未知日期';

        let status = '';
        if (article.is_interesting === 1) {
          status = chalk.green(' ★');
        }

        console.log(`  ${chalk.cyan(article.id.toString().padStart(4))} ${article.title}${status}`);
        console.log(`       ${chalk.dim(`[${article.feed_name}]`)} ${chalk.dim(date)}`);
        if (article.link) {
          console.log(`       ${chalk.blue(article.link)}`);
        }
        console.log();
      }

      console.log(chalk.gray(`共 ${articles.length} 篇文章`));
    });

  // resources - 查看标签下的资源
  tag
    .command('resources <tagName>')
    .description('查看标签下的资源')
    .option('-n, --limit <limit>', '显示数量', parseInt)
    .action((tagName, options) => {
      const tagInfo = cacheService.getTagByName(tagName);

      if (!tagInfo) {
        console.log(chalk.red(`标签 "${tagName}" 不存在`));
        return;
      }

      const resources = cacheService.getResourcesByTag(tagInfo.id, options.limit || 50);

      if (resources.length === 0) {
        console.log(chalk.yellow(`标签 "${tagName}" 下暂无资源`));
        return;
      }

      console.log(chalk.bold.green(`\n📦 标签 #${tagName} 下的资源\n`));

      for (const resource of resources) {
        const sourceInfo =
          resource.source_count > 1
            ? chalk.red(`★ ${resource.source_count} 个来源`)
            : chalk.gray(`${resource.source_count} 个来源`);

        console.log(
          `  ${chalk.yellow(`#${resource.id}`)} ${chalk.bold(resource.name)} ${sourceInfo}`
        );
        if (resource.description) {
          console.log(`     ${chalk.gray(resource.description)}`);
        }
        console.log();
      }

      console.log(chalk.gray(`共 ${resources.length} 个资源`));
    });

  return tag;
}
