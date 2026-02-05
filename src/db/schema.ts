export const SCHEMA = `
-- RSS 源表
CREATE TABLE IF NOT EXISTS feeds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  category TEXT,
  proxy_mode TEXT DEFAULT 'auto',  -- 'auto' | 'direct' | 'proxy'
  proxy_success_count INTEGER DEFAULT 0,
  direct_success_count INTEGER DEFAULT 0,
  last_fetched_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 标签表
CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT,                          -- tech|topic|language|framework|other
  color TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);

-- 文章-标签关联表
CREATE TABLE IF NOT EXISTS article_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  source TEXT DEFAULT 'llm',              -- llm|manual|auto
  confidence REAL DEFAULT 1.0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, tag_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_article_tags_article_id ON article_tags(article_id);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag_id ON article_tags(tag_id);

-- 资源-标签关联表
CREATE TABLE IF NOT EXISTS resource_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(resource_id, tag_id),
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_resource_tags_resource_id ON resource_tags(resource_id);
CREATE INDEX IF NOT EXISTS idx_resource_tags_tag_id ON resource_tags(tag_id);

-- 文章表
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_id INTEGER NOT NULL,
  guid TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT,
  content TEXT,
  pub_date DATETIME,
  is_read INTEGER DEFAULT 0,
  is_interesting INTEGER,        -- LLM 判断: 1=有趣, 0=不感兴趣, NULL=未处理
  interest_reason TEXT,          -- LLM 判断理由
  summary TEXT,                  -- LLM 摘要
  analyzed_at DATETIME,          -- 分析时间（避免重复分析）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(feed_id, guid),
  FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
);

-- 用户偏好表（供 LLM 过滤参考）
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,            -- 'interest' | 'ignore'
  keyword TEXT NOT NULL,
  weight INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 全局配置表
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 技术资源表
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,                    -- tool|library|framework|project|service|other
  url TEXT,
  github_url TEXT,
  description TEXT,
  tags TEXT,                             -- 标签（逗号分隔）
  first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  mention_count INTEGER DEFAULT 1,
  UNIQUE(name, type)
);

-- 文章-资源关联表
CREATE TABLE IF NOT EXISTS article_resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL,
  resource_id INTEGER NOT NULL,
  context TEXT,                          -- 提及上下文
  relevance TEXT DEFAULT 'mentioned',    -- main|mentioned|compared
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, resource_id),
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE,
  FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE
);

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date);
CREATE INDEX IF NOT EXISTS idx_articles_is_interesting ON articles(is_interesting);
CREATE INDEX IF NOT EXISTS idx_articles_analyzed_at ON articles(analyzed_at);
CREATE INDEX IF NOT EXISTS idx_feeds_category ON feeds(category);
CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type);
CREATE INDEX IF NOT EXISTS idx_resources_mention_count ON resources(mention_count);
CREATE INDEX IF NOT EXISTS idx_article_resources_article_id ON article_resources(article_id);
CREATE INDEX IF NOT EXISTS idx_article_resources_resource_id ON article_resources(resource_id);
`;
