# 数据库快速选择指南

## 🎯 三种数据库选项

你的项目支持三种数据库存储方式：

| 数据库 | 配置值 | 适用场景 | 免费额度 |
|--------|---------|----------|----------|
| **Cloudflare KV** | `kv` | 简单键值存储，少量数据 | 100K 读/天, 1K 写/天 |
| **Cloudflare D1** | `d1` | ⭐ 推荐！SQL 查询，复杂数据 | 5M 读/天, 100K 写/天 |
| **Neon PostgreSQL** | `neon` | 大规模数据，企业级应用 | 10K 读/天, 10K 写/天 |

## 📊 快速对比

```
性能：D1 ≈ Neon > KV
配额：D1 > KV ≈ Neon
复杂度：KV < D1 ≈ Neon
延迟：KV ≈ D1 < Neon
```

## 🚀 快速开始

### 选项 1：使用 D1（推荐）✨

**最适合：中小型应用，需要查询能力**

```toml
# wrangler.toml
DATABASE_TYPE = "d1"

[[d1_databases]]
binding = "POSTS_D1"
database_name = "social-moments"
database_id = "your-database-id"
```

**设置步骤：**
```bash
# 1. 创建 D1 数据库
wrangler d1 create social-moments

# 2. 配置 wrangler.toml（使用返回的 ID）

# 3. 部署
wrangler deploy
```

**详细文档：** [D1_SETUP_GUIDE.md](./D1_SETUP_GUIDE.md)

---

### 选项 2：继续使用 KV

**最适合：个人博客，数据量小（<1000 条）**

```toml
# wrangler.toml
DATABASE_TYPE = "kv"
```

**无需额外配置**，开箱即用！

**特点：**
- ✅ 简单易用
- ✅ 极低延迟
- ✅ 自动限制 20 篇文章
- ⚠️ 查询能力有限
- ⚠️ 免费配额较低

---

### 选项 3：使用 Neon PostgreSQL

**最适合：大规模数据，企业级应用**

```toml
# wrangler.toml
DATABASE_TYPE = "neon"

[vars]
DATABASE_URL = "postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require"
```

**设置步骤：**
```bash
# 1. 注册 Neon: https://neon.tech
# 2. 创建项目
# 3. 复制连接字符串
# 4. 配置到 wrangler.toml
```

**详细文档：** [NEON_SETUP_GUIDE.md](./NEON_SETUP_GUIDE.md)

---

## 🔄 切换数据库

### 从 KV 切换到 D1

1. 按照 **选项 1** 设置 D1
2. 运行迁移工具：

```bash
curl "https://your-worker.workers.dev/api/migrate?token=migration-token-please-change-me"
```

3. 确认迁移成功后，切换配置：
```toml
DATABASE_TYPE = "d1"
```

4. 重新部署：`wrangler deploy`

**详细文档：** [KV_TO_D1_MIGRATION.md](./KV_TO_D1_MIGRATION.md)

### 从 D1 切换回 KV

只需修改 `wrangler.toml`：

```toml
DATABASE_TYPE = "kv"
```

重新部署即可（数据不会自动迁移回去）。

---

## 💡 推荐配置

### 小型个人博客（<100 篇文章）

**推荐：KV**
- 简单
- 免费
- 快速

### 中型应用（100-10,000 篇文章）

**推荐：D1** ⭐
- SQL 查询
- 高配额
- 低延迟

### 大型应用（>10,000 篇文章）

**推荐：D1 或 Neon**
- D1：边缘部署，低成本
- Neon：成熟稳定，功能丰富

---

## 📈 性能参考

### 响应时间（测试数据）

| 操作 | KV | D1 | Neon |
|------|-----|-----|------|
| 读取 100 篇文章 | ~100ms | ~50ms | ~200ms |
| 发布文章 | ~150ms | ~100ms | ~300ms |
| 复杂查询 | N/A | ~150ms | ~250ms |

### 存储成本（免费版）

| 数据库 | 最大存储 | 月度读 | 月度写 |
|--------|----------|---------|---------|
| KV | 1 GB | 3M | 30K |
| D1 | 5 GB | 150M | 3M |
| Neon | 0.5 GB | 300K | 300K |

---

## 🆘 需要帮助？

### 选择困难症？

- **不知道选哪个？** 先用 **D1**，最通用
- **想要最简单？** 用 **KV**
- **想要最强大？** 用 **Neon**

### 迁移问题？

- 查看 [KV_TO_D1_MIGRATION.md](./KV_TO_D1_MIGRATION.md)
- 查看 [D1_SETUP_GUIDE.md](./D1_SETUP_GUIDE.md)
- 查看 [NEON_SETUP_GUIDE.md](./NEON_SETUP_GUIDE.md)

### 技术支持？

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 文档](https://developers.cloudflare.com/d1/)
- [Neon 文档](https://neon.tech/docs)

---

## 📝 快速检查清单

使用前确认：

- [ ] 已选择数据库类型（kv/d1/neon）
- [ ] 已配置相关绑定（KV/D1/Neon URL）
- [ ] 已运行 `wrangler deploy`
- [ ] 已测试基本功能（发布、查看）
- [ ] 如需迁移，已完成数据迁移

---

**准备好开始了吗？** 选择一个数据库，开始你的应用吧！ 🚀
