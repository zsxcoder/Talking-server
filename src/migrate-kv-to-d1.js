// KV 到 D1 迁移工具
// 使用方法: wrangler dev -- --migrate-kv-to-d1

/**
 * 迁移 KV 数据到 D1 数据库
 *
 * 步骤：
 * 1. 读取所有 KV 中的文章
 * 2. 读取所有 KV 中的会话
 * 3. 写入到 D1 数据库
 * 4. 验证数据完整性
 */

export async function migrateKVToD1(env) {
  console.log('=== 开始 KV 到 D1 迁移 ===\n');

  const stats = {
    posts: { migrated: 0, failed: 0 },
    sessions: { migrated: 0, failed: 0 },
    errors: []
  };

  try {
    // 1. 检查 D1 是否可用
    if (!env.POSTS_D1) {
      throw new Error('D1 数据库未绑定。请在 wrangler.toml 中配置 [[d1_databases]]');
    }

    console.log('✅ D1 数据库已连接\n');

    // 2. 初始化 D1 表结构
    await initializeD1Tables(env.POSTS_D1);
    console.log('✅ D1 表结构已初始化\n');

    // 3. 迁移文章
    console.log('📝 开始迁移文章...');
    await migratePosts(env, stats);
    console.log(`✅ 文章迁移完成: ${stats.posts.migrated} 成功, ${stats.posts.failed} 失败\n`);

    // 4. 迁移会话
    console.log('🔑 开始迁移会话...');
    await migrateSessions(env, stats);
    console.log(`✅ 会话迁移完成: ${stats.sessions.migrated} 成功, ${stats.sessions.failed} 失败\n`);

    // 5. 验证数据
    console.log('🔍 验证数据完整性...');
    await validateMigration(env, stats);

    // 6. 生成报告
    console.log('\n=== 迁移完成 ===');
    console.log(JSON.stringify(stats, null, 2));

    return stats;
  } catch (error) {
    console.error('\n❌ 迁移失败:', error);
    stats.errors.push(error.message);
    throw error;
  }
}

async function initializeD1Tables(db) {
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS posts (
        id TEXT PRIMARY KEY,
        title TEXT,
        content TEXT,
        tags TEXT,
        date TEXT,
        updated_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT
      )
    `);

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (date DESC)
    `);
  } catch (error) {
    console.error('初始化 D1 表失败:', error);
    throw error;
  }
}

async function migratePosts(env, stats) {
  try {
    // 获取所有文章键
    const list = await env.POSTS_KV.list({ prefix: 'post:' });
    console.log(`找到 ${list.keys.length} 篇文章`);

    // 并行读取所有文章数据
    const posts = [];
    const readPromises = list.keys.map(async (key) => {
      const data = await env.POSTS_KV.get(key.name, 'json');
      if (data) {
        posts.push(data);
      }
      return data;
    });

    await Promise.all(readPromises);
    console.log(`成功读取 ${posts.length} 篇文章\n`);

    // 批量写入 D1
    const batchSize = 100;
    for (let i = 0; i < posts.length; i += batchSize) {
      const batch = posts.slice(i, i + batchSize);

      try {
        const statements = batch.map(post =>
          env.POSTS_D1.prepare(`
            INSERT OR REPLACE INTO posts (id, title, content, tags, date, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            post.id,
            post.title || '',
            post.content,
            JSON.stringify(post.tags || []),
            post.date,
            post.updatedAt || null
          )
        );

        await env.POSTS_D1.batch(statements);
        stats.posts.migrated += batch.length;

        console.log(`✅ 批量迁移 ${i + 1}-${Math.min(i + batchSize, posts.length)}/${posts.length}`);
      } catch (error) {
        console.error(`❌ 批量迁移失败 (${i}-${i + batchSize}):`, error);
        stats.posts.failed += batch.length;
        stats.errors.push(`批次 ${i}-${i + batchSize}: ${error.message}`);

        // 逐条尝试
        for (const post of batch) {
          try {
            await env.POSTS_D1.prepare(`
              INSERT OR REPLACE INTO posts (id, title, content, tags, date, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).bind(
              post.id,
              post.title || '',
              post.content,
              JSON.stringify(post.tags || []),
              post.date,
              post.updatedAt || null
            ).run();
            stats.posts.migrated++;
            stats.posts.failed--;
          } catch (singleError) {
            console.error(`❌ 单个文章迁移失败 (${post.id}):`, singleError);
            stats.errors.push(`文章 ${post.id}: ${singleError.message}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('迁移文章失败:', error);
    throw error;
  }
}

async function migrateSessions(env, stats) {
  try {
    // 获取所有会话键
    const list = await env.POSTS_KV.list({ prefix: 'session:' });
    console.log(`找到 ${list.keys.length} 个会话`);

    if (list.keys.length === 0) {
      console.log('没有会话需要迁移');
      return;
    }

    // 并行读取所有会话数据
    const sessions = [];
    const readPromises = list.keys.map(async (key) => {
      const data = await env.POSTS_KV.get(key.name, 'json');
      if (data) {
        sessions.push({
          token: key.name.replace('session:', ''),
          ...data
        });
      }
      return data;
    });

    await Promise.all(readPromises);
    console.log(`成功读取 ${sessions.length} 个会话\n`);

    // 批量写入 D1
    const batchSize = 100;
    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);

      try {
        const statements = batch.map(session =>
          env.POSTS_D1.prepare(`
            INSERT OR REPLACE INTO sessions (token, username, created_at, last_accessed, expires_at)
            VALUES (?, ?, ?, ?, ?)
          `).bind(
            session.token,
            session.username,
            session.createdAt ? new Date(session.createdAt).toISOString() : null,
            session.lastAccessed ? new Date(session.lastAccessed).toISOString() : null,
            session.expiredAt ? new Date(session.expiredAt).toISOString() : null
          )
        );

        await env.POSTS_D1.batch(statements);
        stats.sessions.migrated += batch.length;

        console.log(`✅ 批量迁移 ${i + 1}-${Math.min(i + batchSize, sessions.length)}/${sessions.length}`);
      } catch (error) {
        console.error(`❌ 批量迁移失败 (${i}-${i + batchSize}):`, error);
        stats.sessions.failed += batch.length;
        stats.errors.push(`会话批次 ${i}-${i + batchSize}: ${error.message}`);

        // 逐条尝试
        for (const session of batch) {
          try {
            await env.POSTS_D1.prepare(`
              INSERT OR REPLACE INTO sessions (token, username, created_at, last_accessed, expires_at)
              VALUES (?, ?, ?, ?, ?)
            `).bind(
              session.token,
              session.username,
              session.createdAt ? new Date(session.createdAt).toISOString() : null,
              session.lastAccessed ? new Date(session.lastAccessed).toISOString() : null,
              session.expiredAt ? new Date(session.expiredAt).toISOString() : null
            ).run();
            stats.sessions.migrated++;
            stats.sessions.failed--;
          } catch (singleError) {
            console.error(`❌ 单个会话迁移失败 (${session.token}):`, singleError);
            stats.errors.push(`会话 ${session.token}: ${singleError.message}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('迁移会话失败:', error);
    throw error;
  }
}

async function validateMigration(env, stats) {
  try {
    // 验证文章数量
    const kvPostCount = (await env.POSTS_KV.list({ prefix: 'post:' })).keys.length;
    const d1PostResult = await env.POSTS_D1.prepare('SELECT COUNT(*) as count FROM posts').first();
    const d1PostCount = d1PostResult.count;

    console.log(`📊 文章数量对比:`);
    console.log(`   KV: ${kvPostCount}`);
    console.log(`   D1: ${d1PostCount}`);

    if (kvPostCount !== d1PostCount) {
      console.warn(`⚠️  文章数量不匹配: ${Math.abs(kvPostCount - d1PostCount)} 篇缺失`);
    } else {
      console.log(`   ✅ 数量匹配`);
    }

    // 验证会话数量
    const kvSessionCount = (await env.POSTS_KV.list({ prefix: 'session:' })).keys.length;
    const d1SessionResult = await env.POSTS_D1.prepare('SELECT COUNT(*) as count FROM sessions').first();
    const d1SessionCount = d1SessionResult.count;

    console.log(`\n📊 会话数量对比:`);
    console.log(`   KV: ${kvSessionCount}`);
    console.log(`   D1: ${d1SessionCount}`);

    if (kvSessionCount !== d1SessionCount) {
      console.warn(`⚠️  会话数量不匹配: ${Math.abs(kvSessionCount - d1SessionCount)} 个缺失`);
    } else {
      console.log(`   ✅ 数量匹配`);
    }

    // 如果有错误，打印详细信息
    if (stats.errors.length > 0) {
      console.log(`\n⚠️  迁移过程中发现 ${stats.errors.length} 个错误:`);
      stats.errors.forEach((error, index) => {
        console.log(`   ${index + 1}. ${error}`);
      });
    }
  } catch (error) {
    console.error('验证失败:', error);
  }
}

// 暴露为 API 端点
export async function handleMigrateRequest(request, env) {
  try {
    // 简单的认证检查
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (token !== 'migration-token-please-change-me') {
      return new Response('未授权：需要有效的迁移令牌', { status: 401 });
    }

    // 执行迁移
    const stats = await migrateKVToD1(env);

    return new Response(JSON.stringify({
      success: true,
      message: '迁移完成',
      stats: stats
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      success: false,
      message: '迁移失败',
      error: error.message
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
