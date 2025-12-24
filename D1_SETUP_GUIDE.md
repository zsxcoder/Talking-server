# Cloudflare D1 数据库设置指南

## 🎯 什么是 D1？

Cloudflare D1 是一个 SQLite 兼容的边缘数据库，具有以下优势：

- **边缘部署**：数据在全球边缘网络分布，延迟极低
- **免费额度大**：每天 5,000,000 次读取，100,000 次写入
- **SQL 支持**：完整的 SQL 查询能力
- **无缝集成**：与 Cloudflare Workers 原生集成
- **比 KV 更适合复杂数据**：支持索引、关联查询等

## 📊 数据库对比

| 特性 | KV | D1 | Neon |
|------|-----|-----|------|
| 类型 | 键值存储 | SQLite | PostgreSQL |
| 查询能力 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 读取成本/天 | 100,000 次 | 5,000,000 次 | 10,000 次 (免费) |
| 写入成本/天 | 1,000 次 | 100,000 次 | 10,000 次 (免费) |
| 存储空间 | 1 GB | 5 GB | 0.5 GB (免费) |
| 边缘延迟 | 极低 | 极低 | 中等 |
| SQL 支持 | ❌ | ✅ | ✅ |
| 索引 | ❌ | ✅ | ✅ |

## 🚀 设置步骤

### 1. 创建 D1 数据库

```bash
# 创建 D1 数据库
wrangler d1 create social-moments
```

执行后会得到类似输出：

```
✅ Successfully created DB 'social-moments'

[[d1_databases]]
binding = "POSTS_D1"
database_name = "social-moments"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 2. 配置 wrangler.toml

将上面的配置添加到你的 `wrangler.toml` 文件中：

```toml
[[d1_databases]]
binding = "POSTS_D1"
database_name = "social-moments"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 3. 初始化数据库表结构

运行以下命令初始化数据库：

```bash
# 首次部署时会自动创建表结构
wrangler deploy
```

或者手动执行 SQL：

```bash
# 使用 D1 控制台
wrangler d1 execute social-moments --command="SELECT * FROM posts"
```

### 4. 切换到 D1 模式

修改 `wrangler.toml` 中的 `DATABASE_TYPE`：

```toml
# 将 DATABASE_TYPE 改为 "d1"
DATABASE_TYPE = "d1"
```

### 5. 部署应用

```bash
wrangler deploy
```

## 📁 数据库表结构

### posts 表

```sql
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  tags TEXT,  -- JSON 数组存储
  date TEXT,
  updated_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_posts_date ON posts (date DESC);
```

### sessions 表

```sql
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT
);
```

## 🔧 常用命令

### 查看数据库

```bash
# 列出所有 D1 数据库
wrangler d1 list

# 查看数据库信息
wrangler d1 info social-moments
```

### 执行 SQL 查询

```bash
# 查询所有文章
wrangler d1 execute social-moments --command="SELECT * FROM posts ORDER BY date DESC LIMIT 10"

# 查询会话
wrangler d1 execute social-moments --command="SELECT * FROM sessions WHERE expires_at > datetime('now')"

# 统计数据
wrangler d1 execute social-moments --command="SELECT COUNT(*) as total FROM posts"
```

### 导入数据

```bash
# 从 CSV 导入
wrangler d1 execute social-moments --file=posts.csv

# 从 SQL 文件导入
wrangler d1 execute social-moments --file=init.sql
```

### 备份数据

```bash
# 导出数据到 JSON
wrangler d1 execute social-moments --command="SELECT * FROM posts" --json > backup.json

# 导出为 SQL
wrangler d1 execute social-moments --command="SELECT * FROM posts" --remote --json > backup.json
```

## 📈 性能优化

### 1. 使用索引

D1 自动创建以下索引：

```sql
CREATE INDEX idx_posts_date ON posts (date DESC);
```

### 2. 批量操作

使用事务处理批量操作：

```javascript
await env.POSTS_D1.batch([
  env.POSTS_D1.prepare("INSERT INTO posts ...").bind(...),
  env.POSTS_D1.prepare("INSERT INTO posts ...").bind(...),
]);
```

### 3. 缓存策略

- 读取密集型场景：使用 D1 的缓存功能
- 写入密集型场景：批量提交

## 🔍 监控和调试

### 查看日志

```bash
# 查看 Worker 日志
wrangler tail

# 实时监控 D1 查询
# 在日志中搜索 "D1"
```

### 性能分析

```bash
# 测试查询性能
wrangler d1 execute social-moments --command="EXPLAIN QUERY PLAN SELECT * FROM posts ORDER BY date DESC"
```

### 数据库统计

访问 `/api/stats` 端点查看数据库统计信息：

```json
{
  "posts": { "total": 20 },
  "sessions": { "active": 5, "expired": 2 },
  "database": { "type": "cloudflare_d1" }
}
```

## 🚨 常见问题

### Q1: D1 和 KV 哪个更好？

**A: 取决于你的需求：**

- **使用 KV**：如果你只需要简单的键值存储，数据量小（<1000 条）
- **使用 D1**：如果需要复杂查询、大量数据、索引支持

### Q2: 可以从 KV 迁移到 D1 吗？

**A: 可以！** 参考 [KV_TO_D1_MIGRATION.md](./KV_TO_D1_MIGRATION.md) 了解详细步骤。

### Q3: D1 的数据会持久化吗？

**A: 会。** D1 的数据是持久化的，不像某些边缘缓存。

### Q4: D1 支持事务吗？

**A: 支持。** 使用 `env.POSTS_D1.batch()` 方法进行批量事务操作。

### Q5: D1 的限制是什么？

**A: 主要限制：**

- 单个数据库最大 5 GB
- 单个查询最多返回 10,000 行
- 建议单个 SQL 语句不超过 1 MB

## 🔄 从 KV 迁移到 D1

### 自动迁移

如果你已经使用 KV 存储了文章数据，可以自动迁移：

1. 创建一个迁移脚本 `/api/migrate-kv-to-d1`
2. 脚本会：
   - 读取所有 KV 数据
   - 写入 D1 数据库
   - 验证数据完整性

### 手动迁移

```bash
# 1. 导出 KV 数据
wrangler kv:bulk put --binding=POSTS_KV < data.json

# 2. 导入到 D1
# 编写脚本读取 JSON 并插入到 D1
```

## 💡 最佳实践

### 1. 定期备份

```bash
# 每周备份一次
crontab -e
0 0 * * 0 wrangler d1 execute social-moments --command="SELECT * FROM posts" --json > backup-$(date +%Y%m%d).json
```

### 2. 监控性能

定期检查：
- 查询执行时间
- 数据库大小
- 索引使用情况

### 3. 优化查询

- 使用索引
- 避免 SELECT *
- 使用 LIMIT 限制返回行数

## 🎉 总结

✅ **D1 是边缘数据库的最佳选择**
✅ **免费额度充足，适合中小型应用**
✅ **完全兼容 SQL，支持复杂查询**
✅ **与 Cloudflare 生态系统无缝集成**
✅ **全球边缘部署，延迟极低**

开始使用 D1，享受边缘数据库的强大功能吧！

---

**需要帮助？**
- [Cloudflare D1 官方文档](https://developers.cloudflare.com/d1/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)
