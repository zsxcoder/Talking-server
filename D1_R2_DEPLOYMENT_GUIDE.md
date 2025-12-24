# Talking-server 部署指南

> 基于 Cloudflare Workers + D1 数据库 + R2 存储的朋友圈项目部署完整指南

## 目录
- [环境准备](#环境准备)
- [创建资源](#创建资源)
- [配置 wrangler.toml](#配置-wranglertoml)
- [本地开发](#本地开发)
- [部署到 Cloudflare](#部署到-cloudflare)
- [数据库管理](#数据库管理)
- [常见问题](#常见问题)

---

## 环境准备

### 1. 安装 Node.js
确保你的系统已安装 Node.js 18 或更高版本：

```bash
node --version  # 应该显示 v18.0.0 或更高
```

### 2. 安装 Wrangler CLI
Wrangler 是 Cloudflare Workers 的官方命令行工具：

```bash
npm install -g wrangler
```

验证安装：

```bash
wrangler --version  # 应该显示类似 4.x.x.x 的版本号
```

### 3. 登录 Cloudflare
```bash
wrangler login
```
按照提示在浏览器中登录你的 Cloudflare 账户。

### 4. 克隆项目
```bash
git clone https://github.com/your-username/Talking-server.git
cd Talking-server
```

### 5. 安装依赖
```bash
npm install
# 或使用 pnpm
pnpm install
```

---

## 创建资源

### 创建 D1 数据库

D1 是 Cloudflare 提供的 SQLite 兼容数据库。

#### 方法一：通过命令行创建（推荐）

```bash
wrangler d1 create social-moments
```

成功后会返回类似以下信息：

```
✅ Successfully created DB 'social-moments'

[[d1_databases]]
binding = "POSTS_D1"
database_name = "social-moments"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**重要信息：**
- `binding`: 代码中使用的变量名，记为 `POSTS_D1`
- `database_id`: 数据库唯一标识符，需要配置到 `wrangler.toml`

#### 方法二：通过 Dashboard 创建

1. 访问 https://dash.cloudflare.com/
2. 进入 **Workers & Pages** → **D1**
3. 点击 "Create database"
4. 输入数据库名称 `social-moments`
5. 创建后复制 `database_id`

### 创建 R2 存储桶

R2 是 Cloudflare 提供的 S3 兼容对象存储服务。

#### 通过命令行创建（推荐）

```bash
wrangler r2 bucket create talk
```

成功后会显示：

```
✅ Successfully created bucket 'talk'
```

**重要信息：**
- `binding`: 代码中使用的变量名，记为 `POST_BUCKET`
- `bucket_name`: 存储桶名称 `talk`

#### 通过 Dashboard 创建

1. 进入 **Workers & Pages** → **R2**
2. 点击 "Create bucket"
3. 输入存储桶名称 `talk`
4. 选择区域（推荐选择最近的区域）

---

## 配置 wrangler.toml

在项目根目录下的 `wrangler.toml` 文件中配置绑定：

```toml
name = "social-moments"
main = "src/index.js"
compatibility_date = "2025-07-21"

# D1 数据库配置
[[d1_databases]]
binding = "POSTS_D1"
database_name = "social-moments"
database_id = "你的数据库ID"  # 替换为实际的 database_id

# R2 存储桶配置
[[r2_buckets]]
binding = "POST_BUCKET"
bucket_name = "talk"

[vars]
# 数据库类型：'d1' (Cloudflare D1), 'kv' (Cloudflare KV), 'neon' (Neon PostgreSQL)
DATABASE_TYPE = "d1"

# 存储类型：'R2' (Cloudflare R2) 或 'OSS' (阿里云 OSS)
STORAGE_TYPE = "R2"

# GitHub OAuth 配置（用于管理员登录）
GITHUB_CLIENT_ID = "你的GitHub应用ID"
GITHUB_CLIENT_SECRET = "你的GitHub应用密钥"
ADMIN_USERS = '["你的GitHub用户名"]'
```

### GitHub OAuth 配置

1. 访问 https://github.com/settings/developers
2. 点击 "New OAuth App"
3. 填写应用信息：
   - **Application name**: `朋友圈管理`
   - **Homepage URL**: `https://你的域名/`
   - **Authorization callback URL**: `https://你的域名/auth/callback`
4. 创建后获得：
   - **Client ID**: 填入 `GITHUB_CLIENT_ID`
   - **Client Secret**: 填入 `GITHUB_CLIENT_SECRET`

---

## 本地开发

### 1. 初始化 D1 数据库表结构

本地数据库需要在首次使用时初始化表结构：

```bash
# 初始化本地数据库（创建表）
wrangler d1 execute social-moments --local --command="CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT, content TEXT, tags TEXT, date TEXT, updated_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_accessed TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT); CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (date DESC);"
```

验证表创建成功：

```bash
# 查看表
wrangler d1 execute social-moments --local --command="SELECT sql FROM sqlite_master WHERE type='table'"
```

### 2. 启动本地开发服务器

```bash
wrangler dev
```

启动后会显示：

```
⛅️ wrangler 4.53.0
-------------------
Starting local server...
http://localhost:8788
```

访问 http://localhost:8788 即可查看效果。

### 3. 本地数据库管理

```bash
# 查看所有文章
wrangler d1 execute social-moments --local --command="SELECT * FROM posts ORDER BY date DESC"

# 查看文章数量
wrangler d1 execute social-moments --local --command="SELECT COUNT(*) as count FROM posts"

# 查看所有会话
wrangler d1 execute social-moments --local --command="SELECT * FROM sessions"

# 查看文章详情
wrangler d1 execute social-moments --local --command="SELECT * FROM posts WHERE id = '文章ID'"

# 删除文章
wrangler d1 execute social-moments --local --command="DELETE FROM posts WHERE id = '文章ID'"

# 清空所有文章
wrangler d1 execute social-moments --local --command="DELETE FROM posts"

# 重置数据库（删除所有表）
wrangler d1 execute social-moments --local --command="DROP TABLE IF EXISTS posts; DROP TABLE IF EXISTS sessions"
```

---

## 部署到 Cloudflare

### 1. 初始化远程数据库表结构

首次部署前需要初始化远程数据库：

```bash
# 初始化远程数据库
wrangler d1 execute social-moments --remote --command="CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT, content TEXT, tags TEXT, date TEXT, updated_at TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, username TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, last_accessed TEXT DEFAULT CURRENT_TIMESTAMP, expires_at TEXT); CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (date DESC);"
```

验证远程表创建：

```bash
# 查看远程表
wrangler d1 execute social-moments --remote --command="SELECT sql FROM sqlite_master WHERE type='table' AND name='posts'"
```

### 2. 部署 Worker

```bash
wrangler deploy
```

部署成功后会显示：

```
⛅️ wrangler 4.53.0
-------------------
Total Upload: 120.77 KiB / gzip: 21.54 KiB
Your Worker has access to the following bindings:
Binding  → Resource
env.POSTS_KV (661e9fe9...)    → KV Namespace
env.POSTS_D1 (social-moments)    → D1 Database
env.POST_BUCKET (talk)          → R2 Bucket
env.DATABASE_TYPE ("d1")           → Environment Variable
env.STORAGE_TYPE ("R2")           → Environment Variable
...
Uploaded social-moments (4.48 sec)
Deployed social-moments triggers (1.69 sec)
  https://social-moments.kemiaojun.workers.dev
Current Version ID: 9a800c1e-...
```

**你的域名信息：**
- `https://social-moments.kemiaojun.workers.dev`：访问应用的主域名
- `Current Version ID`：每次部署的唯一标识

### 3. 部署后验证

访问部署后的域名，测试以下功能：
- 首页是否正常显示文章列表
- 图片是否正常加载
- 管理员登录是否正常
- 发布文章是否成功
- 图片上传是否成功

---

## 数据库管理

### D1 数据库表结构

#### posts 表（文章表）

| 字段名 | 类型 | 说明 |
|---------|------|------|
| id | TEXT | 文章唯一标识符（主键）|
| title | TEXT | 文章标题 |
| content | TEXT | 文章内容（支持 Markdown）|
| tags | TEXT | 标签（JSON 数组字符串）|
| date | TEXT | 发布日期 |
| updated_at | TEXT | 最后更新时间 |
| created_at | TEXT | 创建时间 |

#### sessions 表（会话表）

| 字段名 | 类型 | 说明 |
|---------|------|------|
| token | TEXT | 会话令牌（主键）|
| username | TEXT | 用户名 |
| created_at | TEXT | 会话创建时间 |
| last_accessed | TEXT | 最后访问时间 |
| expires_at | TEXT | 过期时间 |

### 远程数据库管理

```bash
# 查看远程所有文章
wrangler d1 execute social-moments --remote --command="SELECT id, date, tags FROM posts ORDER BY date DESC LIMIT 10"

# 查看远程文章数量
wrangler d1 execute social-moments --remote --command="SELECT COUNT(*) as count FROM posts"

# 查看远程会话数
wrangler d1 execute social-moments --remote --command="SELECT COUNT(*) as count FROM sessions"

# 清理过期会话
wrangler d1 execute social-moments --remote --command="DELETE FROM sessions WHERE expires_at < datetime('now')"

# 查看数据库大小
wrangler d1 info social-moments
```

### R2 存储管理

```bash
# 列出所有存储桶
wrangler r2 bucket list

# 列出指定存储桶的所有文件
wrangler r2 object list talk

# 列出文件详情（包括大小）
wrangler r2 object list talk --include=prefix

# 删除单个文件
wrangler r2 object delete talk 图片文件名.jpg

# 批量删除文件
wrangler r1 object delete talk 图片1.jpg 图片2.jpg 图片3.jpg

# 上传文件
wrangler r2 object put talk 本地文件.jpg

# 查看文件信息
wrangler r2 object info talk 图片文件名.jpg
```

---

## API 接口

项目提供 RESTful API 接口，支持跨域访问。

### 获取所有文章

```bash
GET /api/posts
```

**响应示例：**

```json
{
  "success": true,
  "data": [
    {
      "id": "1735024000000",
      "title": "",
      "content": "测试动态",
      "tags": ["测试"],
      "date": "2024-12-24 12:00:00",
      "updatedAt": "2024-12-24 12:00:00"
    }
  ],
  "count": 1
}
```

### 获取单篇文章

```bash
GET /api/posts/:id
```

**参数：**
- `id`: 文章 ID

**响应示例：**

```json
{
  "success": true,
  "data": {
    "id": "1735024000000",
    "title": "",
    "content": "测试动态",
    "tags": ["测试"],
    "date": "2024-12-24 12:00:00",
    "updatedAt": "2024-12-24 12:00:00"
  }
}
```

### 获取统计数据

```bash
GET /api/stats
```

**响应示例：**

```json
{
  "success": true,
  "data": {
    "total_posts": 1,
    "api_version": "1.0.0"
  }
}
```

### API 健康检查

```bash
GET /api/health
```

**响应示例：**

```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2024-12-24T12:00:00.000Z",
    "database_type": "d1"
  }
}
```

### API 错误响应

所有错误响应格式统一：

```json
{
  "success": false,
  "error": "错误信息"
}
```

### API 使用示例

#### JavaScript Fetch

```javascript
// 获取所有文章
const response = await fetch('https://你的域名/api/posts');
const result = await response.json();

if (result.success) {
  console.log('文章列表：', result.data);
  console.log('总数：', result.count);
}
```

#### cURL

```bash
# 获取所有文章
curl https://你的域名/api/posts

# 获取单篇文章
curl https://你的域名/api/posts/1735024000000

# 获取统计数据
curl https://你的域名/api/stats

# 健康检查
curl https://你的域名/api/health
```

#### Python Requests

```python
import requests

# 获取所有文章
response = requests.get('https://你的域名/api/posts')
result = response.json()

if result['success']:
    for post in result['data']:
        print(f"{post['date']}: {post['content'][:50]}...")
```

---

## 常见问题

### Q1: 如何切换到 KV 数据库？

修改 `wrangler.toml` 中的 `DATABASE_TYPE`：

```toml
[vars]
DATABASE_TYPE = "kv"  # 从 "d1" 改为 "kv"
```

重新部署即可生效。

### Q2: 如何使用 Neon PostgreSQL？

修改 `wrangler.toml` 中的 `DATABASE_TYPE`：

```toml
[vars]
DATABASE_TYPE = "neon"
DATABASE_URL = "postgresql://user:password@ep-xxx.region.aws.neon.tech/neondb?sslmode=require"
```

### Q3: 部署后图片无法显示？

检查 R2 存储桶配置：
1. 确认 R2 存储桶已创建
2. 确认 `wrangler.toml` 中的 `bucket_name` 正确
3. 检查图片 URL 是否正确生成

查看 R2 文件列表：
```bash
wrangler r2 object list talk
```

### Q4: D1 数据库初始化失败？

确保使用正确的命令：

```bash
# 本地数据库（不加 --remote）
wrangler d1 execute social-moments --local --command="..."

# 远程数据库（必须加 --remote）
wrangler d1 execute social-moments --remote --command="..."
```

### Q5: 如何查看实时日志？

**方法一：Wrangler Tail（推荐）**

```bash
wrangler tail
```

然后访问应用，日志会实时显示。

**方法二：Cloudflare Dashboard**

1. 访问 https://dash.cloudflare.com/
2. 进入 **Workers & Pages**
3. 找到 `social-moments` Worker
4. 点击 **Logs** 标签页查看日志

### Q6: 如何清空数据库？

```bash
# 清空所有文章
wrangler d1 execute social-moments --remote --command="DELETE FROM posts"

# 清空所有会话
wrangler d1 execute social-moments --remote --command="DELETE FROM sessions"

# 清空 R2 存储桶
wrangler r2 object delete talk --recursive  # 注意：此命令会删除所有文件
```

### Q7: 如何备份数据？

```bash
# 备份 D1 数据库
wrangler d1 execute social-moments --remote --command="SELECT * FROM posts" > posts_backup.json

# 备份 R2 文件
wrangler r2 object get talk 图片文件.jpg --file=本地备份路径.jpg
```

### Q8: 如何限制文章数量？

项目已内置自动清理功能，只保留最新的 30 篇文章。如需修改：

编辑 `src/admin.js` 第 197 行：

```javascript
await dbWrapper.adapter.cleanupOldPosts(30);  // 将 30 改为其他数字
```

编辑 `src/admin.js` 第 269 行（编辑文章时的清理）：

```javascript
await dbWrapper.adapter.cleanupOldPosts(30);  // 将 30 改为其他数字
```

重新部署后生效。

---

## 技术架构

```
┌─────────────────────────────────────────────┐
│   Cloudflare Workers                   │
│  ┌──────────────────────────────────┐   │
│  │   Application (index.js)   │   │
│  └──────────────────────────────────┘   │
│         ↓  ↓  ↓  ↓                 │
│  ┌──────┬──────┬──────┐        │
│  │  D1  │  R2   │  KV   │        │
│  │ DB   │ Bucket│ Store│        │
│  └──────┴──────┴──────┘        │
└─────────────────────────────────────────────┘
```

- **Workers**: Serverless 计算平台，处理所有 HTTP 请求
- **D1**: SQLite 数据库，存储文章和会话数据
- **R2**: 对象存储，存储上传的图片
- **KV**: 键值存储，用于会话管理（如果使用 KV 模式）

---

## 项目特性

- ✅ 支持多数据库后端（D1 / KV / Neon PostgreSQL）
- ✅ 支持多存储后端（R2 / 阿里云 OSS）
- ✅ GitHub OAuth 管理员登录
- ✅ Markdown 内容渲染
- ✅ 图片九宫格布局
- ✅ Lightbox 灯箱图片查看
- ✅ 深色/浅色主题切换
- ✅ 响应式设计
- ✅ 自动清理旧文章
- ✅ 标签管理

---

## 更新日志

### v1.0.0 (2025-12-24)
- ✅ 初始版本发布
- ✅ 支持 D1 数据库
- ✅ 支持 R2 存储
- ✅ 图片九宫格布局
- ✅ Lightbox 灯箱功能
- ✅ 管理员后台

---

## 许可证

MIT License

---

## 技术支持

如有问题，请访问：
- Cloudflare Workers 文档: https://developers.cloudflare.com/workers/
- D1 数据库文档: https://developers.cloudflare.com/d1/
- R2 存储文档: https://developers.cloudflare.com/r2/
- Wrangler CLI 文档: https://developers.cloudflare.com/workers/wrangler/
