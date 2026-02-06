import { Command } from 'commander';
import chalk from 'chalk';
import { cacheService } from '../services/cache.js';
import { getSqlite } from '../db/index.js';

interface AnalysisStats {
  coverage: {
    total: number;
    analyzed: number;
    unanalyzed: number;
    rate: number;
  };
  filtering: {
    interesting: number;
    notInteresting: number;
    interestingRate: number;
    reasonTypes: number;
  };
  summary: {
    avgLength: number;
    minLength: number;
    maxLength: number;
    medianLength: number;
    validCount: number;
    invalidCount: number;
    basedOnTitleCount: number;
  };
  resources: {
    total: number;
    avgPerArticle: number;
    typeDistribution: Record<string, number>;
    hotResources: Array<{
      name: string;
      type: string;
      mention_count: number;
      article_count: number;
      source_count: number;
    }>;
  };
  tags: {
    total: number;
    avgPerArticle: number;
    hotTags: Array<{
      name: string;
      article_count: number;
    }>;
  };
}

interface ArticleSample {
  id: number;
  title: string;
  feed_name: string;
  pub_date: string | null;
  is_interesting: number | null;
  interest_reason: string | null;
  summary: string | null;
  content_preview: string;
  resources: Array<{
    name: string;
    type: string;
    relevance: string;
  }>;
  tags: string[];
}

function calculateMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function randomSample<T>(array: T[], size: number): T[] {
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(size, array.length));
}

function getAnalysisStats(days: number): AnalysisStats {
  const sqlite = getSqlite();

  // 覆盖率统计
  const totalQuery = `
    SELECT COUNT(*) as count
    FROM articles
    WHERE pub_date >= datetime('now', '-' || ? || ' days')
  `;
  const total = (sqlite.prepare(totalQuery).get(days) as { count: number }).count;

  const analyzedQuery = `
    SELECT COUNT(*) as count
    FROM articles
    WHERE pub_date >= datetime('now', '-' || ? || ' days')
      AND analyzed_at IS NOT NULL
  `;
  const analyzed = (sqlite.prepare(analyzedQuery).get(days) as { count: number }).count;

  // 过滤效果统计
  const interestingQuery = `
    SELECT COUNT(*) as count
    FROM articles
    WHERE pub_date >= datetime('now', '-' || ? || ' days')
      AND analyzed_at IS NOT NULL
      AND is_interesting = 1
  `;
  const interesting = (sqlite.prepare(interestingQuery).get(days) as { count: number }).count;

  const reasonTypesQuery = `
    SELECT COUNT(DISTINCT interest_reason) as count
    FROM articles
    WHERE pub_date >= datetime('now', '-' || ? || ' days')
      AND analyzed_at IS NOT NULL
  `;
  const reasonTypes = (sqlite.prepare(reasonTypesQuery).get(days) as { count: number }).count;

  // 摘要质量统计
  const summaryLengthsQuery = `
    SELECT summary
    FROM articles
    WHERE pub_date >= datetime('now', '-' || ? || ' days')
      AND analyzed_at IS NOT NULL
      AND summary IS NOT NULL
      AND summary != ''
  `;
  const summaries = sqlite.prepare(summaryLengthsQuery).all(days) as Array<{ summary: string }>;
  const summaryLengths = summaries.map(s => s.summary.length);

  const validSummaries = summaries.filter(
    s => !s.summary.includes('无法生成摘要') && !s.summary.includes('内容不完整')
  ).length;

  const basedOnTitleCount = summaries.filter(
    s => s.summary.includes('[基于标题]')
  ).length;

  // 资源统计
  const resourceStatsQuery = `
    SELECT
      r.type,
      COUNT(*) as count
    FROM resources r
    WHERE r.first_seen_at >= datetime('now', '-' || ? || ' days')
    GROUP BY r.type
  `;
  const resourceStats = sqlite.prepare(resourceStatsQuery).all(days) as Array<{
    type: string;
    count: number;
  }>;

  const totalResourcesQuery = `
    SELECT COUNT(*) as count
    FROM resources
    WHERE first_seen_at >= datetime('now', '-' || ? || ' days')
  `;
  const totalResources = (sqlite.prepare(totalResourcesQuery).get(days) as { count: number }).count;

  const avgResourcesQuery = `
    SELECT AVG(resource_count) as avg
    FROM (
      SELECT COUNT(ar.resource_id) as resource_count
      FROM articles a
      LEFT JOIN article_resources ar ON a.id = ar.article_id
      WHERE a.pub_date >= datetime('now', '-' || ? || ' days')
        AND a.analyzed_at IS NOT NULL
      GROUP BY a.id
    )
  `;
  const avgResources = (sqlite.prepare(avgResourcesQuery).get(days) as { avg: number | null }).avg ?? 0;

  // 热门资源
  const hotResources = cacheService.getHotResources({ days, limit: 20 });

  // 标签统计
  const totalTagsQuery = `
    SELECT COUNT(DISTINCT t.id) as count
    FROM tags t
    JOIN article_tags at ON t.id = at.tag_id
    JOIN articles a ON at.article_id = a.id
    WHERE a.pub_date >= datetime('now', '-' || ? || ' days')
      AND a.analyzed_at IS NOT NULL
  `;
  const totalTags = (sqlite.prepare(totalTagsQuery).get(days) as { count: number }).count;

  const avgTagsQuery = `
    SELECT AVG(tag_count) as avg
    FROM (
      SELECT COUNT(at.tag_id) as tag_count
      FROM articles a
      LEFT JOIN article_tags at ON a.id = at.article_id
      WHERE a.pub_date >= datetime('now', '-' || ? || ' days')
        AND a.analyzed_at IS NOT NULL
      GROUP BY a.id
    )
  `;
  const avgTags = (sqlite.prepare(avgTagsQuery).get(days) as { avg: number | null }).avg ?? 0;

  const hotTagsQuery = `
    SELECT t.name, COUNT(DISTINCT at.article_id) as article_count
    FROM tags t
    JOIN article_tags at ON t.id = at.tag_id
    JOIN articles a ON at.article_id = a.id
    WHERE a.pub_date >= datetime('now', '-' || ? || ' days')
      AND a.analyzed_at IS NOT NULL
    GROUP BY t.id
    ORDER BY article_count DESC
    LIMIT 30
  `;
  const hotTags = sqlite.prepare(hotTagsQuery).all(days) as Array<{
    name: string;
    article_count: number;
  }>;

  return {
    coverage: {
      total,
      analyzed,
      unanalyzed: total - analyzed,
      rate: total > 0 ? (analyzed / total) * 100 : 0,
    },
    filtering: {
      interesting,
      notInteresting: analyzed - interesting,
      interestingRate: analyzed > 0 ? (interesting / analyzed) * 100 : 0,
      reasonTypes,
    },
    summary: {
      avgLength: summaryLengths.length > 0
        ? summaryLengths.reduce((a, b) => a + b, 0) / summaryLengths.length
        : 0,
      minLength: summaryLengths.length > 0 ? Math.min(...summaryLengths) : 0,
      maxLength: summaryLengths.length > 0 ? Math.max(...summaryLengths) : 0,
      medianLength: calculateMedian(summaryLengths),
      validCount: validSummaries,
      invalidCount: summaries.length - validSummaries,
      basedOnTitleCount,
    },
    resources: {
      total: totalResources,
      avgPerArticle: avgResources,
      typeDistribution: Object.fromEntries(
        resourceStats.map(r => [r.type, r.count])
      ),
      hotResources: hotResources.map(r => ({
        name: r.name,
        type: r.type,
        mention_count: r.mention_count,
        article_count: r.article_count,
        source_count: r.source_count,
      })),
    },
    tags: {
      total: totalTags,
      avgPerArticle: avgTags,
      hotTags,
    },
  };
}

function getArticleSamples(days: number, sampleSize: number): ArticleSample[] {
  const sqlite = getSqlite();

  // 获取已分析的文章
  const articlesQuery = `
    SELECT a.*, f.name as feed_name
    FROM articles a
    JOIN feeds f ON a.feed_id = f.id
    WHERE a.pub_date >= datetime('now', '-' || ? || ' days')
      AND a.analyzed_at IS NOT NULL
    ORDER BY a.pub_date DESC
  `;
  const articles = sqlite.prepare(articlesQuery).all(days) as Array<{
    id: number;
    title: string;
    feed_name: string;
    pub_date: string | null;
    content: string | null;
    is_interesting: number | null;
    interest_reason: string | null;
    summary: string | null;
  }>;

  // 随机抽样
  const samples = randomSample(articles, sampleSize);

  // 为每个样本获取资源和标签
  return samples.map(article => {
    const resourcesQuery = `
      SELECT r.name, r.type, ar.relevance
      FROM resources r
      JOIN article_resources ar ON r.id = ar.resource_id
      WHERE ar.article_id = ?
      ORDER BY ar.relevance DESC, r.name
    `;
    const resources = sqlite.prepare(resourcesQuery).all(article.id) as Array<{
      name: string;
      type: string;
      relevance: string;
    }>;

    const tagsQuery = `
      SELECT t.name
      FROM tags t
      JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ?
      ORDER BY t.name
    `;
    const tags = (sqlite.prepare(tagsQuery).all(article.id) as Array<{ name: string }>)
      .map(t => t.name);

    const contentPreview = article.content
      ? article.content.substring(0, 200).replace(/\s+/g, ' ')
      : '';

    return {
      id: article.id,
      title: article.title,
      feed_name: article.feed_name,
      pub_date: article.pub_date,
      is_interesting: article.is_interesting,
      interest_reason: article.interest_reason,
      summary: article.summary,
      content_preview: contentPreview,
      resources,
      tags,
    };
  });
}

function printStats(stats: AnalysisStats): void {
  console.log(chalk.bold('\n📊 分析覆盖率统计'));
  console.log('─'.repeat(60));
  console.log(`总文章数：${stats.coverage.total}`);
  console.log(`已分析：${stats.coverage.analyzed} (${stats.coverage.rate.toFixed(1)}%)`);
  console.log(`未分析：${stats.coverage.unanalyzed} (${(100 - stats.coverage.rate).toFixed(1)}%)`);

  console.log(chalk.bold('\n📈 过滤效果统计'));
  console.log('─'.repeat(60));
  console.log(`有趣文章：${stats.filtering.interesting} (${stats.filtering.interestingRate.toFixed(1)}%)`);
  console.log(`不感兴趣：${stats.filtering.notInteresting} (${(100 - stats.filtering.interestingRate).toFixed(1)}%)`);
  console.log(`判断理由种类：${stats.filtering.reasonTypes}`);

  console.log(chalk.bold('\n📝 摘要质量统计'));
  console.log('─'.repeat(60));
  console.log(`平均长度：${stats.summary.avgLength.toFixed(0)} 字`);
  console.log(`长度范围：${stats.summary.minLength} - ${stats.summary.maxLength} 字`);
  console.log(`中位数长度：${stats.summary.medianLength.toFixed(0)} 字`);
  const totalSummaries = stats.summary.validCount + stats.summary.invalidCount;
  console.log(`有效摘要：${stats.summary.validCount} (${totalSummaries > 0 ? ((stats.summary.validCount / totalSummaries) * 100).toFixed(1) : 0}%)`);
  console.log(`无效摘要：${stats.summary.invalidCount} (${totalSummaries > 0 ? ((stats.summary.invalidCount / totalSummaries) * 100).toFixed(1) : 0}%)`);
  console.log(`基于标题推断：${stats.summary.basedOnTitleCount}`);

  console.log(chalk.bold('\n🔧 资源提取统计'));
  console.log('─'.repeat(60));
  console.log(`总资源数：${stats.resources.total}`);
  console.log(`平均每篇：${stats.resources.avgPerArticle.toFixed(1)} 个`);
  console.log('资源类型分布：');
  for (const [type, count] of Object.entries(stats.resources.typeDistribution)) {
    const percentage = stats.resources.total > 0
      ? ((count / stats.resources.total) * 100).toFixed(1)
      : '0.0';
    console.log(`  - ${type}: ${count} (${percentage}%)`);
  }

  console.log(chalk.bold('\n🔥 热门资源 TOP 20'));
  console.log('─'.repeat(60));
  for (let i = 0; i < Math.min(20, stats.resources.hotResources.length); i++) {
    const r = stats.resources.hotResources[i];
    console.log(
      `${(i + 1).toString().padStart(2)}. ${r.name.padEnd(25)} ` +
      `(${r.type.padEnd(10)}) - ` +
      `${r.source_count} 来源, ${r.article_count} 文章, ${r.mention_count} 提及`
    );
  }

  console.log(chalk.bold('\n🏷️  标签分类统计'));
  console.log('─'.repeat(60));
  console.log(`总标签数：${stats.tags.total}`);
  console.log(`平均每篇：${stats.tags.avgPerArticle.toFixed(1)} 个`);

  console.log(chalk.bold('\n🏷️  热门标签 TOP 30'));
  console.log('─'.repeat(60));
  const columns = 3;
  const rows = Math.ceil(stats.tags.hotTags.length / columns);
  for (let row = 0; row < rows; row++) {
    const line = [];
    for (let col = 0; col < columns; col++) {
      const idx = row + col * rows;
      if (idx < stats.tags.hotTags.length) {
        const tag = stats.tags.hotTags[idx];
        line.push(`${tag.name} (${tag.article_count})`.padEnd(25));
      }
    }
    console.log(line.join(''));
  }
}

function printSamples(samples: ArticleSample[]): void {
  console.log(chalk.bold(`\n📄 随机样本（共 ${samples.length} 篇）`));
  console.log('═'.repeat(80));

  for (let i = 0; i < samples.length; i++) {
    const article = samples[i];
    console.log(chalk.bold(`\n样本 ${i + 1}/${samples.length}`));
    console.log('─'.repeat(80));
    console.log(`标题：${article.title}`);
    console.log(`来源：${article.feed_name}`);
    console.log(`发布时间：${article.pub_date ?? '未知'}`);

    const isInteresting = article.is_interesting === 1;
    console.log(
      `\n判断：${isInteresting ? chalk.green('✅ 有趣') : chalk.red('❌ 不感兴趣')}`
    );
    console.log(`理由：${article.interest_reason ?? '无'}`);

    if (article.summary) {
      const summaryLength = article.summary.length;
      console.log(`\n摘要（${summaryLength} 字）：`);
      console.log(article.summary);
    } else {
      console.log('\n摘要：无');
    }

    if (article.resources.length > 0) {
      console.log(`\n提取资源（${article.resources.length} 个）：`);
      for (const res of article.resources) {
        console.log(`  - ${res.name} (type: ${res.type}, relevance: ${res.relevance})`);
      }
    } else {
      console.log('\n提取资源：无');
    }

    if (article.tags.length > 0) {
      console.log(`\n标签（${article.tags.length} 个）：`);
      console.log(`  ${article.tags.join(', ')}`);
    } else {
      console.log('\n标签：无');
    }

    console.log(`\n原文摘要（前 200 字）：`);
    console.log(article.content_preview || '无内容');
  }

  console.log('\n' + '═'.repeat(80));
}

export function createAnalyzeReportCommand(): Command {
  const analyzeReport = new Command('analyze-report')
    .description(`分析智能分析效果并生成报告。

用途说明:
  从数据库加载已分析的文章数据，评估分析效果（准确性、质量、覆盖度），
  并随机抽取样本供人工审查。用于评估和改进 LLM 提示词。

使用示例:
  rss analyze-report                      # 分析最近 30 天，展示 50 个样本
  rss analyze-report --days 60            # 分析最近 60 天
  rss analyze-report --sample-size 100    # 展示 100 个样本
  rss analyze-report --output json        # 输出 JSON 格式`)
    .option('--days <number>', '分析最近 N 天的数据', '30')
    .option('--sample-size <number>', '样本数量', '50')
    .option('--output <format>', '输出格式: console, json', 'console')
    .action(async (options) => {
      const days = parseInt(options.days, 10);
      const sampleSize = parseInt(options.sampleSize, 10);
      const outputFormat = options.output;

      console.log(chalk.bold(`\n🔍 分析智能分析效果（最近 ${days} 天）`));
      console.log('═'.repeat(80));

      // 获取统计数据
      const stats = getAnalysisStats(days);

      // 获取样本
      const samples = getArticleSamples(days, sampleSize);

      if (outputFormat === 'json') {
        console.log(JSON.stringify({ stats, samples }, null, 2));
      } else {
        printStats(stats);
        printSamples(samples);

        console.log(chalk.bold('\n💡 下一步'));
        console.log('─'.repeat(80));
        console.log('1. 审查上述样本，评估过滤准确性、摘要质量、资源提取和标签分类效果');
        console.log('2. 识别提示词问题（误判模式、摘要问题、资源提取问题、标签问题）');
        console.log('3. 根据问题提出改进建议');
        console.log('4. 修改 src/services/llm.ts 中的提示词');
        console.log('5. 对部分文章重新分析，验证改进效果');
      }
    });

  return analyzeReport;
}
