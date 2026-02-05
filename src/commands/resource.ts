import { Command } from 'commander';
import chalk from 'chalk';
import { cacheService } from '../services/cache.js';
import type { ResourceWithStats } from '../models/resource.js';

function formatResourceType(type: string): string {
  const typeColors: Record<string, (s: string) => string> = {
    tool: chalk.blue,
    library: chalk.green,
    framework: chalk.magenta,
    project: chalk.cyan,
    service: chalk.yellow,
    other: chalk.gray,
  };
  const colorFn = typeColors[type] || chalk.white;
  return colorFn(type.padEnd(10));
}

function displayResource(resource: ResourceWithStats, showDetails = false): void {
  const sourceInfo =
    resource.source_count > 1
      ? chalk.red(`★ ${resource.source_count} 个来源`)
      : chalk.gray(`${resource.source_count} 个来源`);

  console.log(
    `${chalk.yellow(`#${resource.id}`)} ${formatResourceType(resource.type)} ${chalk.bold(resource.name)} ${sourceInfo}`
  );

  if (resource.description) {
    console.log(`   ${chalk.gray(resource.description)}`);
  }

  if (showDetails) {
    if (resource.url) {
      console.log(`   ${chalk.blue('🔗 ' + resource.url)}`);
    }
    if (resource.github_url) {
      console.log(`   ${chalk.gray('📦 ' + resource.github_url)}`);
    }
    if (resource.tags_array.length > 0) {
      console.log(`   ${chalk.cyan('🏷️  ' + resource.tags_array.join(', '))}`);
    }
    console.log(
      `   ${chalk.gray(`提及 ${resource.mention_count} 次 | ${resource.article_count} 篇文章`)}`
    );
  }
}

export function createResourceCommand(): Command {
  const resource = new Command('resource').description('技术资源管理');

  // hot - 查看热门资源
  resource
    .command('hot')
    .description('查看热门资源（按来源数排序）')
    .option('-d, --days <days>', '限制天数', parseInt)
    .option('-t, --type <type>', '资源类型 (tool|library|framework|project|service|other)')
    .option('-n, --limit <limit>', '显示数量', parseInt)
    .option('--tag <tag>', '按标签筛选')
    .action((options) => {
      let resources;

      if (options.tag) {
        resources = cacheService.getResourcesByTagName(options.tag, options.limit || 20);
        if (options.type) {
          resources = resources.filter(r => r.type === options.type);
        }
      } else {
        resources = cacheService.getHotResources({
          days: options.days,
          type: options.type,
          limit: options.limit || 20,
        });
      }

      if (resources.length === 0) {
        console.log(chalk.yellow('暂无资源数据'));
        console.log(chalk.gray('提示: 运行 rss run -s 来分析文章并提取资源'));
        return;
      }

      console.log(chalk.bold.green('\n🔥 热门技术资源\n'));

      if (options.days) {
        console.log(chalk.gray(`(最近 ${options.days} 天)\n`));
      }

      for (const resource of resources) {
        displayResource(resource);
      }

      console.log(chalk.gray(`\n共 ${resources.length} 个资源`));
      console.log(chalk.gray('提示: 使用 rss resource show <id> 查看详情'));
    });

  // search - 搜索资源
  resource
    .command('search <keyword>')
    .description('搜索资源')
    .option('-n, --limit <limit>', '显示数量', parseInt)
    .action((keyword, options) => {
      const resources = cacheService.searchResources(keyword, options.limit || 20);

      if (resources.length === 0) {
        console.log(chalk.yellow(`未找到与 "${keyword}" 相关的资源`));
        return;
      }

      console.log(chalk.bold.green(`\n🔍 搜索结果: "${keyword}"\n`));

      for (const resource of resources) {
        displayResource(resource);
      }

      console.log(chalk.gray(`\n共 ${resources.length} 个结果`));
    });

  // show - 查看资源详情
  resource
    .command('show <id>')
    .description('查看资源详情及关联文章')
    .action((id) => {
      const resourceId = parseInt(id, 10);
      const resource = cacheService.getResourceWithStats(resourceId);

      if (!resource) {
        console.log(chalk.red(`资源 #${id} 不存在`));
        return;
      }

      console.log(chalk.bold.green(`\n📦 资源详情\n`));
      displayResource(resource, true);

      // 获取关联文章
      const articles = cacheService.getArticlesByResource(resourceId);

      if (articles.length > 0) {
        console.log(chalk.bold('\n📰 关联文章:\n'));

        for (const article of articles) {
          const date = article.pub_date
            ? new Date(article.pub_date).toLocaleDateString('zh-CN')
            : '未知日期';

          console.log(`  ${chalk.gray(date)} ${chalk.blue(article.title)}`);
          console.log(`    ${chalk.gray('来源:')} ${article.feed_name}`);
          if (article.link) {
            console.log(`    ${chalk.gray(article.link)}`);
          }
          console.log();
        }
      }
    });

  return resource;
}
