import { Command } from 'commander';
import chalk from 'chalk';
import { cacheService } from '../services/cache.js';
import { getSqlite } from '../db/index.js';

interface StatusData {
  feeds: {
    total: number;
    byCategory: Record<string, number>;
    lastFetchedAt: string | null;
  };
  articles: {
    total: number;
    analyzed: number;
    interesting: number;
    unanalyzed: number;
    recent7Days: number;
  };
  tags: {
    total: number;
    topTags: Array<{ name: string; count: number }>;
  };
  resources: {
    total: number;
    byType: Record<string, number>;
  };
  scraping: {
    totalFetches: number;
    proxySuccess: number;
    directSuccess: number;
  };
}

function getStatusData(): StatusData {
  const sqlite = getSqlite();

  // 1. RSS 源统计
  const feeds = cacheService.getAllFeeds();
  const feedsByCategory: Record<string, number> = {};
  let lastFetchedAt: string | null = null;

  for (const feed of feeds) {
    const category = feed.category || '未分类';
    feedsByCategory[category] = (feedsByCategory[category] || 0) + 1;

    if (feed.last_fetched_at) {
      if (!lastFetchedAt || feed.last_fetched_at > lastFetchedAt) {
        lastFetchedAt = feed.last_fetched_at;
      }
    }
  }

  // 2. 文章统计
  const articleStats = sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_interesting IS NOT NULL THEN 1 ELSE 0 END) as analyzed,
      SUM(CASE WHEN is_interesting = 1 THEN 1 ELSE 0 END) as interesting,
      SUM(CASE WHEN is_interesting IS NULL THEN 1 ELSE 0 END) as unanalyzed,
      SUM(CASE WHEN pub_date >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as recent7Days
    FROM articles
  `).get() as {
    total: number;
    analyzed: number;
    interesting: number;
    unanalyzed: number;
    recent7Days: number;
  };

  // 3. 标签统计
  const tagCount = sqlite.prepare(`SELECT COUNT(*) as count FROM tags`).get() as { count: number };
  const topTags = sqlite.prepare(`
    SELECT t.name, COUNT(at.article_id) as count
    FROM tags t
    LEFT JOIN article_tags at ON t.id = at.tag_id
    GROUP BY t.id
    ORDER BY count DESC
    LIMIT 3
  `).all() as Array<{ name: string; count: number }>;

  // 4. 资源统计
  const resourceCount = sqlite.prepare(`SELECT COUNT(*) as count FROM resources`).get() as { count: number };
  const resourcesByType = sqlite.prepare(`
    SELECT type, COUNT(*) as count
    FROM resources
    GROUP BY type
    ORDER BY count DESC
  `).all() as Array<{ type: string; count: number }>;

  const resourcesByTypeMap: Record<string, number> = {};
  for (const row of resourcesByType) {
    resourcesByTypeMap[row.type] = row.count;
  }

  // 5. 抓取统计
  let totalProxySuccess = 0;
  let totalDirectSuccess = 0;
  for (const feed of feeds) {
    totalProxySuccess += feed.proxy_success_count;
    totalDirectSuccess += feed.direct_success_count;
  }

  return {
    feeds: {
      total: feeds.length,
      byCategory: feedsByCategory,
      lastFetchedAt,
    },
    articles: {
      total: articleStats.total,
      analyzed: articleStats.analyzed,
      interesting: articleStats.interesting,
      unanalyzed: articleStats.unanalyzed,
      recent7Days: articleStats.recent7Days,
    },
    tags: {
      total: tagCount.count,
      topTags: topTags.filter(t => t.count > 0),
    },
    resources: {
      total: resourceCount.count,
      byType: resourcesByTypeMap,
    },
    scraping: {
      totalFetches: totalProxySuccess + totalDirectSuccess,
      proxySuccess: totalProxySuccess,
      directSuccess: totalDirectSuccess,
    },
  };
}

function formatDateTime(isoString: string | null): string {
  if (!isoString) return '从未';
  return new Date(isoString).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function printColoredStatus(data: StatusData): void {
  console.log(chalk.bold.cyan('\n📊 RSS CLI 统计数据'));
  console.log(chalk.gray('-'.repeat(60)));

  // RSS 源
  console.log(chalk.bold('\n📡 RSS 源'));
  console.log(`  总数: ${chalk.yellow(data.feeds.total)}`);
  if (Object.keys(data.feeds.byCategory).length > 0) {
    console.log('  分类:');
    for (const [category, count] of Object.entries(data.feeds.byCategory)) {
      console.log(`    ${category}: ${chalk.cyan(count)}`);
    }
  }
  console.log(`  最后抓取: ${chalk.gray(formatDateTime(data.feeds.lastFetchedAt))}`);

  // 文章
  console.log(chalk.bold('\n📰 文章'));
  console.log(`  总数: ${chalk.yellow(data.articles.total)}`);
  if (data.articles.total > 0) {
    const analyzedPercent = ((data.articles.analyzed / data.articles.total) * 100).toFixed(1);
    console.log(`  已分析: ${chalk.green(data.articles.analyzed)} (${analyzedPercent}%)`);
    console.log(`  精选文章: ${chalk.yellow('★')} ${chalk.green(data.articles.interesting)}`);
    console.log(`  未分析: ${chalk.gray(data.articles.unanalyzed)}`);
    console.log(`  最近 7 天: ${chalk.cyan(data.articles.recent7Days)}`);
  }

  // 标签
  console.log(chalk.bold('\n🏷️  标签'));
  console.log(`  总数: ${chalk.yellow(data.tags.total)}`);
  if (data.tags.topTags.length > 0) {
    console.log('  热门标签:');
    for (const tag of data.tags.topTags) {
      console.log(`    ${chalk.cyan('#' + tag.name)}: ${tag.count} 篇文章`);
    }
  }

  // 技术资源
  console.log(chalk.bold('\n📦 技术资源'));
  console.log(`  总数: ${chalk.yellow(data.resources.total)}`);
  if (Object.keys(data.resources.byType).length > 0) {
    console.log('  类型分布:');
    for (const [type, count] of Object.entries(data.resources.byType)) {
      console.log(`    ${type}: ${chalk.cyan(count)}`);
    }
  }

  // 抓取统计
  console.log(chalk.bold('\n🔄 抓取统计'));
  console.log(`  总抓取次数: ${chalk.yellow(data.scraping.totalFetches)}`);
  console.log(`  代理成功: ${chalk.green(data.scraping.proxySuccess)}`);
  console.log(`  直连成功: ${chalk.green(data.scraping.directSuccess)}`);

  console.log(chalk.gray('\n' + '-'.repeat(60)));
  console.log(chalk.gray('提示: 使用 --json 选项获取 JSON 格式输出\n'));
}

export function createStatusCommand(): Command {
  const status = new Command('status')
    .description(`查看 RSS CLI 的整体运行状态和统计数据。

用途说明:
  快速了解 RSS 订阅源、文章、标签、资源的统计信息，
  以及抓取操作的成功率。类似于 git status 的快照视图。

使用示例:
  rss status              # 查看彩色格式的统计数据
  rss status --json       # 输出 JSON 格式数据`)
    .option('--json', '输出 JSON 格式')
    .action((options) => {
      const data = getStatusData();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        printColoredStatus(data);
      }
    });

  return status;
}
