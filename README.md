# RSS CLI

一个功能丰富的 RSS 订阅管理命令行工具，集成 LLM 智能分析，自动过滤有趣文章、生成摘要、提取技术资源和标签。

## 功能特性

- **RSS 源管理** - 添加、删除、列出订阅源，支持分类和代理模式
- **智能文章分析** - 使用 LLM 自动判断文章价值，过滤低质量内容
- **摘要生成** - 为有趣的文章自动生成中文摘要和关键点
- **技术资源提取** - 自动识别文章中提到的工具、库、框架等技术资源
- **标签系统** - LLM 智能添加标签，支持按标签筛选文章和资源
- **文章快照** - 保存纯文本快照，避免重复抓取
- **代理支持** - 支持 HTTP 代理，自动/手动切换模式

## 安装

```bash
# 克隆项目
git clone <repo-url>
cd rss-cli

# 安装依赖
pnpm install

# 编译
pnpm build

# 全局安装（可选）
npm link
```

## 配置

创建 `.env` 文件配置 LLM：

```env
OPENAI_API_KEY=your-api-key
OPENAI_API_BASE=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# 可选：HTTP 代理
HTTP_PROXY=http://127.0.0.1:7890
```

## 使用方法

### 快速开始

```bash
# 添加 RSS 源
rss feed add https://example.com/feed.xml

# 一键更新并分析
rss run -s

# 查看有趣的文章
rss show -i
```

### RSS 源管理

```bash
# 添加源（自动检测名称）
rss feed add <url>

# 添加源（指定名称和分类）
rss feed add <url> -n "Feed Name" -c tech

# 列出所有源
rss feed list

# 按分类列出
rss feed list -c tech

# 删除源
rss feed remove <id-or-url>
```

### 更新和分析

```bash
# 更新所有源
rss update

# 一键运行（更新 + 分析 + 显示）
rss run

# 生成摘要
rss run -s

# 分析最近 7 天的文章
rss run -d 7

# 强制重新分析
rss run -f

# 跳过更新，只分析
rss run --skip-update
```

### 文章查看

```bash
# 显示文章
rss show

# 只显示有趣的文章
rss show -i

# 按标签筛选
rss show -t javascript,react

# 最近 7 天的文章
rss show -d 7

# 搜索文章
rss search <keyword>

# 查看摘要列表
rss digest
```

### 技术资源

```bash
# 查看热门资源
rss resource hot

# 按类型筛选
rss resource hot -t library

# 按标签筛选
rss resource hot --tag javascript

# 搜索资源
rss resource search <keyword>

# 查看资源详情
rss resource show <id>
```

### 标签管理

```bash
# 列出所有标签
rss tag list

# 搜索标签
rss tag search <keyword>

# 查看标签下的文章
rss tag articles <tag-name>

# 查看标签下的资源
rss tag resources <tag-name>
```

### 用户偏好

```bash
# 添加感兴趣的关键词
rss pref add interest "kubernetes"

# 添加忽略的关键词
rss pref add ignore "招聘"

# 列出偏好
rss pref list

# 删除偏好
rss pref remove <id>
```

## 命令参考

| 命令                     | 说明                 |
| ------------------------ | -------------------- |
| `rss feed add <url>`     | 添加 RSS 源          |
| `rss feed list`          | 列出所有源           |
| `rss feed remove <id>`   | 删除源               |
| `rss update`             | 更新所有源           |
| `rss run`                | 一键更新、分析、显示 |
| `rss show`               | 显示文章             |
| `rss search <keyword>`   | 搜索文章             |
| `rss digest`             | 查看摘要列表         |
| `rss resource hot`       | 热门资源             |
| `rss resource search`    | 搜索资源             |
| `rss tag list`           | 标签列表             |
| `rss tag articles <tag>` | 标签下的文章         |
| `rss pref add`           | 添加偏好             |
| `rss config set`         | 设置配置             |

## 数据存储

数据存储在 `~/.rss-cli/rss.db`（SQLite 数据库）。

## 技术栈

- **TypeScript** - 类型安全
- **Commander.js** - 命令行框架
- **better-sqlite3** - SQLite 数据库
- **rss-parser** - RSS 解析
- **html-to-text** - HTML 转纯文本
- **chalk** - 终端样式
- **ora** - 加载动画

## License

ISC
