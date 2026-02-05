import { Command } from 'commander';
import { writeFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { cacheService } from '../services/cache.js';
import { llmService } from '../services/llm.js';
import type { ArticleWithFeed } from '../models/article.js';
import type { ResourceWithStats } from '../models/resource.js';
import type { TagWithCount } from '../models/tag.js';

const PERIOD_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
};

interface ReportData {
  period: { start: string; end: string; days: number };
  overview: string;
  tags: { name: string; count: number; trend: string }[];
  resources: ResourceWithStats[];
  articles: ArticleWithFeed[];
  feedStats: { name: string; total: number; interesting: number; rate: number }[];
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getTrend(count: number): string {
  if (count >= 10) return '📈';
  if (count >= 5) return '➡️';
  return '📉';
}

function generateMarkdown(data: ReportData, briefSummaries?: Map<number, string>): string {
  const lines: string[] = [];

  lines.push('# RSS 技术周报');
  lines.push(`> 报告周期: ${data.period.start} ~ ${data.period.end} (${data.period.days} 天)`);
  lines.push('');

  // Overview
  lines.push('## 本期概览');
  lines.push(data.overview);
  lines.push('');

  // Hot tags
  if (data.tags.length > 0) {
    lines.push('## 热门话题');
    lines.push('| 话题 | 文章数 | 趋势 |');
    lines.push('|------|--------|------|');
    for (const tag of data.tags.slice(0, 10)) {
      lines.push(`| ${tag.name} | ${tag.count} | ${tag.trend} |`);
    }
    lines.push('');
  }

  // Hot resources
  if (data.resources.length > 0) {
    lines.push('## 热门资源');
    for (const res of data.resources.slice(0, 10)) {
      const typeEmoji = res.type === 'tool' ? '🔧' : res.type === 'library' ? '📦' : res.type === 'framework' ? '🏗️' : '📌';
      lines.push(`### ${typeEmoji} ${res.name}`);
      if (res.description) {
        lines.push(res.description);
      }
      lines.push(`- **类型**: ${res.type}`);
      lines.push(`- **来源数**: ${res.source_count} 个独立来源`);
      if (res.url) {
        lines.push(`- **链接**: ${res.url}`);
      }
      if (res.github_url) {
        lines.push(`- **GitHub**: ${res.github_url}`);
      }
      lines.push('');
    }
  }

  // Featured articles
  if (data.articles.length > 0) {
    lines.push('## 精选文章');
    for (const article of data.articles.slice(0, 15)) {
      const date = article.pub_date ? formatDate(new Date(article.pub_date)) : '未知日期';
      lines.push(`### ${article.title}`);
      lines.push(`> 来源: ${article.feed_name} | ${date}`);
      lines.push('');
      if (article.summary) {
        // 优先使用简短摘要，否则截取原摘要
        const brief = briefSummaries?.get(article.id) || article.summary.slice(0, 80);
        lines.push(brief);
        lines.push('');
      }
      if (article.link) {
        lines.push(`[阅读原文](${article.link})`);
        lines.push('');
      }
    }
  }

  // Feed stats
  if (data.feedStats.length > 0) {
    lines.push('## 信息源统计');
    lines.push('| 来源 | 总文章 | 精选 | 精选率 |');
    lines.push('|------|--------|------|--------|');
    for (const stat of data.feedStats) {
      const rate = stat.rate > 0 ? `${(stat.rate * 100).toFixed(0)}%` : '-';
      lines.push(`| ${stat.name} | ${stat.total} | ${stat.interesting} | ${rate} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function getFeedStats(days: number): ReportData['feedStats'] {
  const feeds = cacheService.getAllFeeds();
  const stats: ReportData['feedStats'] = [];

  for (const feed of feeds) {
    const allArticles = cacheService.getArticles({ feedId: feed.id, days, limit: 1000 });
    const interestingArticles = allArticles.filter(a => a.is_interesting === 1);
    const total = allArticles.length;
    const interesting = interestingArticles.length;
    const rate = total > 0 ? interesting / total : 0;

    if (total > 0) {
      stats.push({ name: feed.name, total, interesting, rate });
    }
  }

  return stats.sort((a, b) => b.interesting - a.interesting);
}

export function createReportCommand(): Command {
  const report = new Command('report')
    .description(`生成指定时间范围内的综合摘要报告。

用途说明:
  创建 RSS 活动的格式化报告，包含以下内容:
  - LLM 生成的概览摘要（200-400字）
  - 热门话题/标签及文章数量和趋势
  - 热门资源（工具、库、框架）
  - 精选有趣文章及摘要
  - 订阅源统计（总文章数、精选率）

输出格式:
  Markdown（默认）: 包含章节和表格的可读报告
  JSON（--json）: 结构化数据，便于程序处理

Markdown 报告结构:
  # RSS 技术周报
  ## 本期概览 - LLM 生成的综合摘要
  ## 热门话题 - 标签表格，含数量和趋势
  ## 热门资源 - 资源详情及描述
  ## 精选文章 - 文章标题、来源、摘要、链接
  ## 信息源统计 - 订阅源表现统计表

JSON 数据结构:
  {
    period: { start, end, days },
    overview: 概览文本,
    tags: [{ name, count, trend }],
    resources: [{ name, type, description, url, source_count }],
    articles: [{ title, link, summary, feed_name, pub_date }],
    feedStats: [{ name, total, interesting, rate }]
  }

使用示例:
  rss report                      # 生成周报到控制台
  rss report -p day               # 生成日报
  rss report -p month             # 生成月报
  rss report -d 14                # 自定义14天报告
  rss report -o ~/report.md       # 保存到文件
  rss report --json               # 输出 JSON 格式
  rss report --json -o data.json  # 保存 JSON 到文件
  rss report --no-resources       # 不包含热门资源章节`)
    .option('-p, --period <period>', '预设时间范围: day(1天), week(7天), month(30天)', 'week')
    .option('-d, --days <n>', '自定义天数（覆盖 --period 设置）')
    .option('-o, --output <file>', '输出到文件而非控制台')
    .option('--no-trends', '不显示标签趋势指示符')
    .option('--no-resources', '不包含热门资源章节')
    .option('--json', '输出 JSON 格式而非 Markdown')
    .action(async (options) => {
      const days = options.days ? parseInt(options.days, 10) : (PERIOD_DAYS[options.period] || 7);
      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const spinner = options.json ? null : ora('Generating report...').start();

      try {
        // Gather data
        const articles = cacheService.getArticles({ interesting: true, days, limit: 100 });
        const resources = options.resources !== false ? cacheService.getHotResources({ days, limit: 20 }) : [];
        const allTags = cacheService.getTagsWithCounts();
        const feedStats = getFeedStats(days);

        // Filter tags with articles in this period
        const tags = allTags
          .filter(t => t.article_count > 0)
          .slice(0, 15)
          .map(t => ({
            name: t.name,
            count: t.article_count,
            trend: getTrend(t.article_count),
          }));

        // Generate overview with LLM
        if (spinner) spinner.text = 'Generating overview with LLM...';
        let overview = '暂无概览';
        let briefSummaries: Map<number, string> | undefined;
        const hasLlmKey = process.env.OPENAI_API_KEY;
        if (hasLlmKey && articles.length > 0) {
          try {
            overview = await llmService.generateOverallSummary(articles, resources, allTags, days);

            // Generate brief summaries for articles
            if (spinner) spinner.text = 'Generating brief summaries...';
            briefSummaries = await llmService.generateBriefSummaries(
              articles.slice(0, 15).map(a => ({ id: a.id, title: a.title, summary: a.summary }))
            );
          } catch (err) {
            console.error('LLM error:', (err as Error).message);
            overview = `本期共收录 ${articles.length} 篇精选文章，涵盖 ${tags.length} 个技术话题。`;
          }
        } else if (articles.length > 0) {
          overview = `本期共收录 ${articles.length} 篇精选文章，涵盖 ${tags.length} 个技术话题。`;
        }

        const reportData: ReportData = {
          period: { start: formatDate(startDate), end: formatDate(endDate), days },
          overview,
          tags,
          resources,
          articles,
          feedStats,
        };

        spinner?.succeed('Report generated');

        // Output
        if (options.json) {
          const output = JSON.stringify(reportData, null, 2);
          if (options.output) {
            writeFileSync(options.output, output, 'utf-8');
            console.log(`Report saved to ${options.output}`);
          } else {
            console.log(output);
          }
        } else {
          const markdown = generateMarkdown(reportData, briefSummaries);
          if (options.output) {
            writeFileSync(options.output, markdown, 'utf-8');
            console.log(chalk.green(`Report saved to ${options.output}`));
          } else {
            console.log(markdown);
          }
        }
      } catch (error) {
        spinner?.fail('Failed to generate report');
        console.error('Error:', (error as Error).message);
        process.exit(1);
      }
    });

  return report;
}
