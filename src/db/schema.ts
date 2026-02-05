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

-- 创建索引以提高查询性能
CREATE INDEX IF NOT EXISTS idx_articles_feed_id ON articles(feed_id);
CREATE INDEX IF NOT EXISTS idx_articles_pub_date ON articles(pub_date);
CREATE INDEX IF NOT EXISTS idx_articles_is_interesting ON articles(is_interesting);
CREATE INDEX IF NOT EXISTS idx_articles_analyzed_at ON articles(analyzed_at);
CREATE INDEX IF NOT EXISTS idx_feeds_category ON feeds(category);
`;
