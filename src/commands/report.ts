import { Command } from 'commander';
import { writeFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { cacheService } from '../services/cache.js';
import { llmService } from '../services/llm.js';
import type { ArticleWithFeed } from '../models/article.js';
import { getSqlite } from '../db/index.js';

export const PERIOD_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
};

export interface ResourceInsight {
  name: string;
  type: string;
  description: string | null;
  url: string | null;
  github_url: string | null;
  articles: { title: string; context: string }[];
}

export interface ReportData {
  period: { start: string; end: string; days: number };
  knowledgePoints: ({ text: string; url?: string } | string)[];
  highlights: { name: string; desc: string; url?: string }[];
  tags: { name: string; count: number; trend: string }[];
  resourceInsights: ResourceInsight[];
  articles: ArticleWithFeed[];
  feedStats: { name: string; total: number; interesting: number; rate: number }[];
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getTrend(count: number): string {
  if (count >= 10) return '📈';
  if (count >= 5) return '➡️';
  return '📉';
}

export function generateMarkdown(data: ReportData): string {
  const lines: string[] = [];

  // Header
  const totalArticles = cacheService.getArticles({ days: data.period.days, limit: 10000 }).length;
  lines.push('# RSS 技术速览');
  lines.push(`> ${data.period.start} ~ ${data.period.end} | 精选 ${data.articles.length} 篇 / 共 ${totalArticles} 篇`);
  lines.push('');

  // 要点速览
  if (data.knowledgePoints.length > 0) {
    lines.push('## 要点速览');
    for (const point of data.knowledgePoints) {
      if (typeof point === 'string') {
        lines.push(`- ${point}`);
      } else {
        const link = point.url ? `[${point.text}](${point.url})` : point.text;
        lines.push(`- ${link}`);
      }
    }
    lines.push('');
  }

  // 值得关注
  if (data.highlights.length > 0) {
    lines.push('## 值得关注');
    for (const h of data.highlights) {
      const link = h.url ? ` [链接](${h.url})` : '';
      lines.push(`- **${h.name}**: ${h.desc}${link}`);
    }
    lines.push('');
  }

  // 趋势（内联格式）
  if (data.tags.length > 0) {
    lines.push('## 趋势');
    const tagLine = data.tags.slice(0, 10).map(t => `${t.name}(${t.count})`).join(' | ');
    lines.push(`**热门**: ${tagLine}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function getFeedStats(days: number): ReportData['feedStats'] {
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

export function getResourceInsights(days: number): ResourceInsight[] {
  const hotResources = cacheService.getHotResources({ days, limit: 20 });

  // 筛选条件：relevance = 'main' 且 source_count >= 2
  const qualifiedResources = hotResources.filter(r => r.source_count >= 2);

  const insights: ResourceInsight[] = [];
  const sqlite = getSqlite();

  for (const resource of qualifiedResources.slice(0, 10)) {
    // 查询关联的文章和 context
    const query = `
      SELECT a.title, ar.context
      FROM article_resources ar
      JOIN articles a ON ar.article_id = a.id
      WHERE ar.resource_id = ? AND ar.relevance = 'main'
      ORDER BY a.pub_date DESC
      LIMIT 5
    `;

    const rows = sqlite.prepare(query).all(resource.id) as { title: string; context: string | null }[];

    if (rows.length > 0) {
      insights.push({
        name: resource.name,
        type: resource.type,
        description: resource.description,
        url: resource.url,
        github_url: resource.github_url,
        articles: rows.map(r => ({ title: r.title, context: r.context || '' })),
      });
    }
  }

  return insights;
}

export interface GenerateReportOptions {
  days: number;
  includeResources?: boolean;
  onProgress?: (msg: string) => void;
}

export interface GenerateReportResult {
  data: ReportData;
}

export async function generateReportData(options: GenerateReportOptions): Promise<GenerateReportResult> {
  const { days, includeResources = true, onProgress } = options;
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

  const articles = cacheService.getArticles({ interesting: true, days, limit: 100 });
  const hotResources = includeResources ? cacheService.getHotResources({ days, limit: 20 }) : [];
  const allTags = cacheService.getTagsWithCounts();
  const feedStats = getFeedStats(days);

  const tags = allTags
    .filter(t => t.article_count > 0)
    .slice(0, 15)
    .map(t => ({
      name: t.name,
      count: t.article_count,
      trend: getTrend(t.article_count),
    }));

  onProgress?.('Generating knowledge points with LLM...');
  let knowledgePoints: ({ text: string; url?: string } | string)[] = [];
  let highlights: { name: string; desc: string; url?: string }[] = [];
  const hasLlmKey = process.env.OPENAI_API_KEY;

  if (hasLlmKey && articles.length > 0) {
    try {
      const result = await llmService.generateKnowledgePoints(articles, days);
      knowledgePoints = result.points;
      highlights = result.highlights;
    } catch (err) {
      console.error('LLM error:', (err as Error).message);
      knowledgePoints = [`本期共收录 ${articles.length} 篇精选文章，涵盖 ${tags.length} 个技术话题。`];
    }
  } else if (articles.length > 0) {
    knowledgePoints = [`本期共收录 ${articles.length} 篇精选文章，涵盖 ${tags.length} 个技术话题。`];
  }

  onProgress?.('Extracting resource insights...');
  const resourceInsights = includeResources ? getResourceInsights(days) : [];

  const data: ReportData = {
    period: { start: formatDate(startDate), end: formatDate(endDate), days },
    knowledgePoints,
    highlights,
    tags,
    resourceInsights,
    articles,
    feedStats,
  };

  return { data };
}

export function createReportCommand(): Command {
  const report = new Command('report')
    .summary('生成指定时间范围内的综合摘要报告')
    .description(`生成指定时间范围内的综合摘要报告。

用途说明:
  创建 RSS 活动的格式化报告，包含以下内容:
  - LLM 提炼的知识点速览（15-20 条）
  - 值得关注的项目/工具推荐
  - 热门话题趋势

输出格式:
  Markdown（默认）: 精简的知识点报告
  JSON（--json）: 结构化数据，便于程序处理

Markdown 报告结构:
  # RSS 技术速览
  ## 要点速览 - 知识点列表
  ## 值得关注 - 项目/工具推荐
  ## 趋势 - 热门话题

使用示例:
  rss report                      # 生成周报到控制台
  rss report -p day               # 生成日报
  rss report -p month             # 生成月报
  rss report -d 14                # 自定义14天报告
  rss report -o ~/report.md       # 保存到文件
  rss report --json               # 输出 JSON 格式
  rss report --json -o data.json  # 保存 JSON 到文件`)
    .option('-p, --period <period>', '预设时间范围: day(1天), week(7天), month(30天)', 'week')
    .option('-d, --days <n>', '自定义天数（覆盖 --period 设置）')
    .option('-o, --output <file>', '输出到文件而非控制台')
    .option('--json', '输出 JSON 格式而非 Markdown')
    .action(async (options) => {
      const days = options.days ? parseInt(options.days, 10) : (PERIOD_DAYS[options.period] || 7);

      const spinner = options.json ? null : ora('Generating report...').start();

      try {
        const { data: reportData } = await generateReportData({
          days,
          onProgress: (msg) => {
            if (spinner) spinner.text = msg;
          },
        });

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
          const markdown = generateMarkdown(reportData);
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
