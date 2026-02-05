import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// RSS 源表
export const feeds = sqliteTable('feeds', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  url: text('url').notNull().unique(),
  category: text('category'),
  proxyMode: text('proxy_mode').default('auto'), // 'auto' | 'direct' | 'proxy'
  proxySuccessCount: integer('proxy_success_count').default(0),
  directSuccessCount: integer('direct_success_count').default(0),
  lastFetchedAt: text('last_fetched_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('idx_feeds_category').on(table.category),
]);

// 标签表
export const tags = sqliteTable('tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  category: text('category'), // tech|topic|language|framework|other
  color: text('color'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('idx_tags_name').on(table.name),
]);

// 文章表
export const articles = sqliteTable('articles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  feedId: integer('feed_id').notNull().references(() => feeds.id, { onDelete: 'cascade' }),
  guid: text('guid').notNull(),
  title: text('title').notNull(),
  link: text('link'),
  content: text('content'),
  pubDate: text('pub_date'),
  isRead: integer('is_read').default(0),
  isInteresting: integer('is_interesting'), // LLM 判断: 1=有趣, 0=不感兴趣, NULL=未处理
  interestReason: text('interest_reason'), // LLM 判断理由
  summary: text('summary'), // LLM 摘要
  analyzedAt: text('analyzed_at'), // 分析时间
  textSnapshot: text('text_snapshot'),
  snapshotAt: text('snapshot_at'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('idx_articles_feed_id').on(table.feedId),
  index('idx_articles_pub_date').on(table.pubDate),
  index('idx_articles_is_interesting').on(table.isInteresting),
  index('idx_articles_analyzed_at').on(table.analyzedAt),
  uniqueIndex('idx_articles_feed_guid').on(table.feedId, table.guid),
]);

// 文章-标签关联表
export const articleTags = sqliteTable('article_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  articleId: integer('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  source: text('source').default('llm'), // llm|manual|auto
  confidence: real('confidence').default(1.0),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('idx_article_tags_article_id').on(table.articleId),
  index('idx_article_tags_tag_id').on(table.tagId),
  uniqueIndex('idx_article_tags_unique').on(table.articleId, table.tagId),
]);

// 技术资源表
export const resources = sqliteTable('resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  type: text('type').notNull(), // tool|library|framework|project|service|other
  url: text('url'),
  githubUrl: text('github_url'),
  description: text('description'),
  tags: text('tags'), // 标签（逗号分隔）
  firstSeenAt: text('first_seen_at').default(sql`CURRENT_TIMESTAMP`),
  mentionCount: integer('mention_count').default(1),
}, (table) => [
  index('idx_resources_type').on(table.type),
  index('idx_resources_mention_count').on(table.mentionCount),
  uniqueIndex('idx_resources_name_type').on(table.name, table.type),
]);

// 资源-标签关联表
export const resourceTags = sqliteTable('resource_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resourceId: integer('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('idx_resource_tags_resource_id').on(table.resourceId),
  index('idx_resource_tags_tag_id').on(table.tagId),
  uniqueIndex('idx_resource_tags_unique').on(table.resourceId, table.tagId),
]);

// 文章-资源关联表
export const articleResources = sqliteTable('article_resources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  articleId: integer('article_id').notNull().references(() => articles.id, { onDelete: 'cascade' }),
  resourceId: integer('resource_id').notNull().references(() => resources.id, { onDelete: 'cascade' }),
  context: text('context'), // 提及上下文
  relevance: text('relevance').default('mentioned'), // main|mentioned|compared
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index('idx_article_resources_article_id').on(table.articleId),
  index('idx_article_resources_resource_id').on(table.resourceId),
  uniqueIndex('idx_article_resources_unique').on(table.articleId, table.resourceId),
]);

// 用户偏好表（供 LLM 过滤参考）
export const userPreferences = sqliteTable('user_preferences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(), // 'interest' | 'ignore'
  keyword: text('keyword').notNull(),
  weight: integer('weight').default(1),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

// 全局配置表
export const config = sqliteTable('config', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
