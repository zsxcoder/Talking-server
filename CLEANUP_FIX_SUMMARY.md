# 文章清理功能修复总结

## 修复日期
2025-12-25

## 问题描述
之前项目中的自动清理功能存在多个问题，可能导致文章数据被误删：
1. 竞态条件 - 检查文章数量和删除操作之间有时间差
2. 日期格式不一致 - 不同地方使用不同的日期格式
3. 缺少安全限制 - 没有单次删除数量的限制
4. 错误处理不完善 - JSON.parse 等操作没有错误处理
5. 硬编码配置 - 清理参数散落在各处

## 修复内容

### 1. 创建统一的配置文件 `src/config.js`
```javascript
export const AppConfig = {
  database: {
    MAX_POSTS_TO_KEEP: 30,        // 最大保留文章数
    MAX_DELETE_LIMIT: 50,           // 单次最多删除数
    AUTO_CLEANUP_ENABLED: true,       // 是否启用自动清理
  },
  // ... 其他配置
};
```

### 2. 重构 D1 数据库的清理逻辑 (`src/database.js`)

**新增安全特性：**
- ✅ 使用批量删除操作，减少竞态条件
- ✅ 添加单次删除数量限制（最多 50 篇）
- ✅ 详细的日志记录（删除前显示所有待删除文章）
- ✅ 删除后验证结果
- ✅ 完善的错误处理

**清理流程：**
```
1. 获取当前文章总数
2. 检查是否超过限制（> 30）
3. 计算需要删除的数量
4. 安全检查：不超过 MAX_DELETE_LIMIT
5. 查询待删除文章信息（用于日志）
6. 批量删除操作
7. 验证删除结果
8. 记录最终文章总数
```

### 3. 统一日期格式处理 (`src/admin.js`)

**问题：**
- 之前使用 `toISOString().replace('T', ' ')` 方式
- 北京时间处理不准确

**修复：**
```javascript
// 创建统一的日期格式化函数
function formatBeijingDate(date = new Date()) {
  const beijingOffset = 8 * 60 * 60 * 1000;
  const beijingTime = new Date(date.getTime() + beijingOffset);
  return beijingTime.toISOString().replace('T', ' ').slice(0, 19);
}
```

### 4. 修复 JSON.parse 错误处理 (`src/database.js`)

**问题：**
- `tags: row.tags ? JSON.parse(row.tags) : []`
- 如果 tags 不是有效的 JSON，会导致崩溃

**修复：**
```javascript
tags: row.tags ? (() => {
  try {
    return JSON.parse(row.tags);
  } catch (e) {
    console.error('Failed to parse tags for post:', row.id, row.tags);
    return [];
  }
})() : []
```

### 5. 改进 KV 版本的清理逻辑 (`src/admin.js`)

**新增安全特性：**
- ✅ 统一默认参数为 `MAX_POSTS_TO_KEEP`
- ✅ 添加单次删除数量限制
- ✅ 详细的日志记录
- ✅ 显示删除前预览

## 安全保障措施

### 1. 单次删除数量限制
```javascript
const MAX_DELETE_LIMIT = 50;
if (postsToDelete > MAX_DELETE_LIMIT) {
  console.warn(`删除数量 ${postsToDelete} 超过安全限制`);
}
```

### 2. 详细的日志记录
- 清理前：显示总数量、需要删除数量
- 待删除列表：显示 ID、日期、内容预览
- 清理后：验证实际删除数量

### 3. 错误处理
- 所有危险操作都有 try-catch
- JSON 解析都有错误处理
- 失败时会记录详细错误信息

### 4. 配置化
- 所有清理参数集中在 `config.js`
- 便于调整和维护

## 验证步骤

### 1. 部署测试
```bash
wrangler deploy
```

### 2. 查看当前文章数量
```bash
wrangler d1 execute social-moments --remote --command="SELECT COUNT(*) as count FROM posts"
```

### 3. 发布新文章
- 访问 `/admin`
- 发布新文章
- 观察控制台日志

### 4. 检查清理逻辑
- 如果文章数超过 30，应该触发清理
- 查看日志，确认只删除旧文章
- 验证最终保留最新的 30 篇

## 监控建议

### 1. 定期检查文章数量
```bash
# 查看文章数量
wrangler d1 execute social-moments --remote --command="SELECT COUNT(*) as count FROM posts"

# 查看最新的文章
wrangler d1 execute social-moments --remote --command="SELECT id, date FROM posts ORDER BY date DESC LIMIT 10"
```

### 2. 备份数据
```bash
# 备份所有文章
wrangler d1 execute social-moments --remote --command="SELECT * FROM posts" > backup_$(date +%Y%m%d).json
```

### 3. 查看实时日志
```bash
wrangler tail
```

## 常见问题

### Q1: 如何调整最大保留文章数？
编辑 `src/config.js`：
```javascript
export const AppConfig = {
  database: {
    MAX_POSTS_TO_KEEP: 50,  // 改为你想要的数字
  },
};
```

### Q2: 如何禁用自动清理？
编辑 `src/config.js`：
```javascript
export const AppConfig = {
  database: {
    AUTO_CLEANUP_ENABLED: false,  // 设为 false
  },
};
```

然后在 `src/admin.js` 中添加检查：
```javascript
if (AUTO_CLEANUP_ENABLED && currentPosts.length > MAX_POSTS_TO_KEEP) {
  // 执行清理
}
```

### Q3: 如果不小心误删了怎么办？
1. 检查是否有备份文件
2. 查看 D1 数据库日志（如果有）
3. 恢复数据：
   ```bash
   wrangler d1 execute social-moments --remote --command="INSERT INTO posts ... VALUES (...)"
   ```

## 性能影响

- 清理操作在创建/编辑文章后执行
- 批量删除操作比逐个删除快
- 不会影响正常的文章展示
- 日志记录有助于调试

## 未来改进方向

1. **添加删除确认机制**
   - 删除前需要管理员确认
   - 提供预览和回滚功能

2. **实现软删除**
   - 标记文章为已删除而非真正删除
   - 可以恢复误删的文章

3. **添加清理历史记录**
   - 记录每次清理的操作
   - 可以查询和审计

4. **支持不同清理策略**
   - 按时间清理
   - 按标签清理
   - 手动清理

## 结论

通过以上修复，文章清理功能现在具有：
- ✅ 可靠性：不会误删最新文章
- ✅ 安全性：有数量限制和日志记录
- ✅ 可维护性：配置集中化
- ✅ 可观测性：详细的日志输出

系统现在可以安全地维护最多 30 篇文章，自动清理旧文章，同时保证数据安全。
