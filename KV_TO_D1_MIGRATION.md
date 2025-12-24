# KV 到 D1 迁移指南

## 🎯 迁移原因

从 Cloudflare KV 迁移到 D1 数据库的优势：

| 特性 | KV | D1 |
|------|-----|-----|
| 数据模型 | 键值对 | 关系型（SQLite） |
| 查询能力 | 简单键查询 | 复杂 SQL 查询 |
| 读取配额/天 | 100,000 | 5,000,000 |
| 写入配额/天 | 1,000 | 100,000 |
| 存储空间 | 1 GB | 5 GB |
| 索引支持 | ❌ | ✅ |
| 事务支持 | ❌ | ✅ |

## 📋 迁移前准备

### 1. 备份现有数据

```bash
# 导出所有文章
curl https://your-worker.workers.dev/api/posts > posts-backup.json

# 导出 KV 数据
wrangler kv:bulk get --binding=POSTS_KV --prefix="post:" > kv-backup.json
wrangler kv:bulk get --binding=POSTS_KV --prefix="session:" > sessions-backup.json
```

### 2. 检查数据量

```bash
# 统计文章数量
curl https://your-worker.workers.dev/api/stats
```

如果数据量很大（>10,000 条），建议分批迁移。

## 🚀 迁移步骤

### 方法一：自动迁移（推荐）

#### 1. 创建 D1 数据库

```bash
wrangler d1 create social-moments
```

记下返回的 `database_id`。

#### 2. 配置 wrangler.toml

将以下配置添加到 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "POSTS_D1"
database_name = "social-moments"
database_id = "your-database-id-here"
```

#### 3. 部署应用

```bash
wrangler deploy
```

#### 4. 执行迁移

访问迁移端点（需要修改令牌）：

```bash
# 使用 curl
curl "https://your-worker.workers.dev/api/migrate?token=migration-token-please-change-me"

# 或在浏览器中访问
https://your-worker.workers.dev/api/migrate?token=migration-token-please-change-me
```

**⚠️ 安全提示**：在生产环境中，请修改 `src/migrate-kv-to-d1.js` 中的令牌：

```javascript
if (token !== 'your-secure-random-token') {
  return new Response('未授权', { status: 401 });
}
```

#### 5. 查看迁移结果

迁移完成后，会返回类似这样的 JSON：

```json
{
  "success": true,
  "message": "迁移完成",
  "stats": {
    "posts": {
      "migrated": 20,
      "failed": 0
    },
    "sessions": {
      "migrated": 5,
      "failed": 0
    },
    "errors": []
  }
}
```

#### 6. 切换到 D1

修改 `wrangler.toml`：

```toml
DATABASE_TYPE = "d1"
```

#### 7. 重新部署

```bash
wrangler deploy
```

### 方法二：手动迁移

如果你需要更多控制，可以使用手动迁移：

#### 1. 导出 KV 数据

```bash
# 导出文章
wrangler kv:bulk --namespace="POSTS_KV" --prefix="post:" --export posts.json

# 导出会话
wrangler kv:bulk --namespace="POSTS_KV" --prefix="session:" --export sessions.json
```

#### 2. 转换数据格式

创建转换脚本 `convert.js`：

```javascript
import fs from 'fs';

// 读取导出的数据
const posts = JSON.parse(fs.readFileSync('posts.json', 'utf-8'));
const sessions = JSON.parse(fs.readFileSync('sessions.json', 'utf-8'));

// 转换为 SQL
const sqlPosts = posts.map(post =>
  `INSERT OR REPLACE INTO posts (id, title, content, tags, date, updated_at)
   VALUES ('${post.id}', '${post.title || ''}', '${post.content.replace(/'/g, "''")}',
           '${JSON.stringify(post.tags)}', '${post.date}', '${post.updatedAt || ''}');`
).join('\n');

const sqlSessions = sessions.map(session =>
  `INSERT OR REPLACE INTO sessions (token, username, created_at, last_accessed, expires_at)
   VALUES ('${session.token}', '${session.username}', '${session.createdAt}',
           '${session.lastAccessed}', '${session.expiresAt}');`
).join('\n');

// 写入 SQL 文件
fs.writeFileSync('migrate-posts.sql', sqlPosts);
fs.writeFileSync('migrate-sessions.sql', sqlSessions);
```

运行转换脚本：

```bash
node convert.js
```

#### 3. 导入到 D1

```bash
# 导入文章
wrangler d1 execute social-moments --file=migrate-posts.sql

# 导入会话
wrangler d1 execute social-moments --file=migrate-sessions.sql
```

## ✅ 验证迁移

### 1. 检查数据量

```bash
# 查询 D1 中的文章数量
wrangler d1 execute social-moments --command="SELECT COUNT(*) as count FROM posts"

# 查询 D1 中的会话数量
wrangler d1 execute social-moments --command="SELECT COUNT(*) as count FROM sessions"
```

### 2. 检查数据完整性

```bash
# 查看最新的 10 篇文章
wrangler d1 execute social-moments --command="SELECT id, date FROM posts ORDER BY date DESC LIMIT 10"

# 查看会话
wrangler d1 execute social-moments --command="SELECT username, expires_at FROM sessions"
```

### 3. 功能测试

访问你的应用，测试：

- ✅ 首页是否显示所有文章
- ✅ 是否可以发布新文章
- ✅ 登录/登出是否正常
- ✅ 编辑和删除功能是否正常

## 🔧 故障排除

### 问题：迁移失败，提示 "D1 数据库未绑定"

**解决**：
1. 检查 `wrangler.toml` 中是否正确配置了 `[[d1_databases]]`
2. 确认 `binding = "POSTS_D1"`
3. 重新部署：`wrangler deploy`

### 问题：部分文章迁移失败

**解决**：
1. 查看迁移日志中的错误信息
2. 检查失败的数据是否包含特殊字符
3. 手动修复失败的数据后重新迁移

### 问题：迁移后数据不显示

**解决**：
1. 检查 `DATABASE_TYPE` 是否设置为 `"d1"`
2. 清除浏览器缓存
3. 检查控制台是否有错误

### 问题：会话丢失

**解决**：
会话有过期时间，如果迁移时间过长，部分会话可能已过期。这是正常现象，用户需要重新登录。

## 📊 迁移后优化

### 1. 删除 KV 数据（可选）

确认 D1 正常工作后，可以清理 KV 数据：

```bash
# 删除所有文章
wrangler kv:bulk delete --binding=POSTS_KV --prefix="post:"

# 删除所有会话
wrangler kv:bulk delete --binding=POSTS_KV --prefix="session:"
```

⚠️ **警告**：删除前确保已备份！

### 2. 监控性能

使用 Cloudflare Dashboard 监控：
- D1 查询延迟
- 查询次数
- 存储使用量

### 3. 优化查询

根据实际使用情况添加更多索引：

```sql
-- 如果经常按标签查询
CREATE INDEX idx_posts_tags ON posts (tags);

-- 如果经常按标题搜索
CREATE INDEX idx_posts_title ON posts (title);
```

## 🎉 迁移完成

恭喜！你已经成功从 KV 迁移到 D1。

### 下一步

1. **享受更好的性能**：D1 的查询能力远超 KV
2. **利用 SQL 功能**：支持复杂查询、聚合、排序等
3. **更高的配额**：免费额度大幅提升

### 维护建议

- 定期备份 D1 数据
- 监控查询性能
- 根据实际需求优化索引
- 清理过期会话

---

**需要帮助？** 查看 [D1_SETUP_GUIDE.md](./D1_SETUP_GUIDE.md) 了解 D1 的详细配置。
