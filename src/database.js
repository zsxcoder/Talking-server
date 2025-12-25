import { MAX_POSTS_TO_KEEP, MAX_DELETE_LIMIT, AUTO_CLEANUP_ENABLED } from './config.js';

// Cloudflare D1 适配层
export class D1Database {
  constructor(env) {
    this.env = env;
    this.db = env.POSTS_D1;

    if (!this.db) {
      console.error('POSTS_D1 binding not found in environment');
    }
  }

  async initialize() {
    try {
      console.log('Initializing D1 database...');

      if (!this.db) {
        console.warn('POSTS_D1 binding not found, skipping database initialization');
        return;
      }

      // 测试连接
      await this.db.prepare('SELECT 1').first();

      console.log('D1 database initialized successfully');

      // 初始化数据库表结构
      await this.initializeTables();
    } catch (error) {
      console.error('Failed to initialize D1 database:', error);
      // 不抛出错误，允许系统回退到 KV
    }
  }

  async initializeTables() {
    try {
      // 创建文章表
      await this.db.exec(`
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

      // 创建会话表
      await this.db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          token TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          last_accessed TEXT DEFAULT CURRENT_TIMESTAMP,
          expires_at TEXT
        )
      `);

      // 创建索引优化查询性能
      await this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (date DESC)
      `);

      console.log('D1 tables initialized');
    } catch (error) {
      console.error('Error initializing D1 tables:', error);
      throw error;
    }
  }

  // 文章相关操作
  async getAllPosts() {
    const startTime = Date.now();
    try {
      console.log('Fetching all posts from D1...');
      const stmt = this.db.prepare('SELECT id, title, content, tags, date, updated_at as "updatedAt" FROM posts ORDER BY date DESC');
      const result = await stmt.all();

      const duration = Date.now() - startTime;
      console.log(`D1 query result:`, result);

      if (!result || !result.results) {
        console.log('No results returned, returning empty array');
        return [];
      }

      console.log(`Fetched ${result.results.length} posts from D1 in ${duration}ms`);

      return result.results.map(row => ({
        ...row,
        tags: row.tags ? (() => {
          try {
            return JSON.parse(row.tags);
          } catch (e) {
            console.error('Failed to parse tags for post:', row.id, row.tags);
            return [];
          }
        })() : []
      }));
    } catch (error) {
      console.error('Error getting all posts from D1:', error);
      console.error('Error stack:', error.stack);
      return [];
    }
  }

  async getPost(postId) {
    try {
      const stmt = this.db.prepare('SELECT id, title, content, tags, date, updated_at as "updatedAt" FROM posts WHERE id = ?');
      const result = await stmt.bind(postId).first();

      if (!result) return null;

      return {
        ...result,
        tags: result.tags ? (() => {
          try {
            return JSON.parse(result.tags);
          } catch (e) {
            console.error('Failed to parse tags for post:', postId, result.tags);
            return [];
          }
        })() : []
      };
    } catch (error) {
      console.error('Error getting post from D1:', error);
      return null;
    }
  }

  async createPost(postData) {
    try {
      console.log('Creating post in D1:', postData);
      const stmt = this.db.prepare('INSERT INTO posts (id, title, content, tags, date) VALUES (?, ?, ?, ?, ?)');
      const result = await stmt.bind(
        postData.id,
        postData.title || '',
        postData.content,
        JSON.stringify(postData.tags || []),
        postData.date
      ).run();

      console.log('Created post in D1:', postData.id, 'Result:', result);
      return postData;
    } catch (error) {
      console.error('Error creating post in D1:', error);
      console.error('Error stack:', error.stack);
      throw error;
    }
  }

  // 安全清理旧文章，只保留最新的指定数量
  // 使用事务确保原子性，防止并发导致的误删
  async cleanupOldPosts(maxPosts = MAX_POSTS_TO_KEEP) {
    try {
      if (!this.db) {
        console.error('D1 database not available, skipping cleanup');
        return;
      }

      console.log('=== 开始安全清理旧文章 ===');
      console.log(`最大保留数量: ${maxPosts}`);

      // 步骤1: 获取当前文章总数
      const countResult = await this.db.prepare('SELECT COUNT(*) as count FROM posts').first();
      if (!countResult || countResult.count === null || countResult.count === undefined) {
        console.error('无法获取文章数量:', countResult);
        return;
      }

      const totalCount = parseInt(countResult.count);
      console.log(`当前文章总数: ${totalCount}`);

      // 步骤2: 检查是否需要清理
      if (totalCount <= maxPosts) {
        console.log(`文章数量 ${totalCount} 未超过限制 ${maxPosts}，无需清理`);
        return;
      }

      const postsToDelete = totalCount - maxPosts;
      console.log(`需要删除的文章数: ${postsToDelete}`);

      // 安全检查: 单次最多删除 50 篇文章，防止意外清空数据库
      const MAX_DELETE_LIMIT = 50;
      if (postsToDelete > MAX_DELETE_LIMIT) {
        console.warn(`⚠️  删除数量 ${postsToDelete} 超过安全限制 ${MAX_DELETE_LIMIT}，只删除 ${MAX_DELETE_LIMIT} 篇`);
      }

      const actualDeleteCount = Math.min(postsToDelete, MAX_DELETE_LIMIT);

      // 步骤3: 查询要删除的文章信息（用于日志记录）
      const postsToDeleteList = await this.db.prepare(
        'SELECT id, date, content FROM posts ORDER BY date ASC LIMIT ?'
      ).bind(actualDeleteCount).all();

      if (!postsToDeleteList || !postsToDeleteList.results || postsToDeleteList.results.length === 0) {
        console.log('没有找到需要删除的文章');
        return;
      }

      console.log(`即将删除 ${postsToDeleteList.results.length} 篇文章:`);
      postsToDeleteList.results.forEach((post, index) => {
        const contentPreview = post.content ? post.content.substring(0, 50) : '(空)';
        console.log(`  ${index + 1}. ID: ${post.id}, 日期: ${post.date}, 内容: ${contentPreview}...`);
      });

      // 步骤4: 删除操作（批量删除）
      const deleteStatements = postsToDeleteList.results.map(post =>
        this.db.prepare('DELETE FROM posts WHERE id = ?').bind(post.id)
      );

      const deleteResult = await this.db.batch(deleteStatements);

      // 验证删除结果
      const actualDeletedCount = deleteResult.length;

      if (actualDeletedCount !== postsToDeleteList.results.length) {
        console.error(`⚠️  删除数量不匹配! 期望: ${postsToDeleteList.results.length}, 实际: ${actualDeletedCount}`);
      } else {
        console.log(`✅ 成功删除 ${actualDeletedCount} 篇旧文章`);
      }

      // 步骤5: 验证当前文章数量
      const finalCountResult = await this.db.prepare('SELECT COUNT(*) as count FROM posts').first();
      const finalCount = finalCountResult ? parseInt(finalCountResult.count) : 0;
      console.log(`清理后文章总数: ${finalCount}`);

      console.log('=== 清理完成 ===');
    } catch (error) {
      console.error('❌ 清理旧文章失败:', error);
      console.error('错误堆栈:', error.stack);

      // 记录到数据库的错误日志表（如果需要）
      // 这里只是记录错误，不会影响主流程
    }
  }

  async updatePost(postId, updateData) {
    try {
      const stmt = this.db.prepare('UPDATE posts SET title = ?, content = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      const result = await stmt.bind(
        updateData.title || '',
        updateData.content,
        JSON.stringify(updateData.tags || []),
        postId
      ).run();

      if (!result?.meta || result.meta.changes === 0) return null;

      console.log('Updated post in D1:', postId);
      return await this.getPost(postId);
    } catch (error) {
      console.error('Error updating post in D1:', error);
      throw error;
    }
  }

  async deletePost(postId) {
    try {
      const stmt = this.db.prepare('DELETE FROM posts WHERE id = ?');
      const result = await stmt.bind(postId).run();

      const deleted = result.meta.changes > 0;
      console.log(`${deleted ? 'Deleted' : 'Not found'} post in D1: ${postId}`);
      return deleted;
    } catch (error) {
      console.error('Error deleting post from D1:', error);
      throw error;
    }
  }

  // 会话相关操作
  async createSession(token, username, expiresIn = 604800) {
    try {
      const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

      const stmt = this.db.prepare('INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)');
      await stmt.bind(token, username, expiresAt).run();

      console.log('Created session in D1 for user:', username);
      return true;
    } catch (error) {
      console.error('Error creating session in D1:', error);
      return false;
    }
  }

  async getSession(token) {
    try {
      // 清理过期会话
      await this.cleanupExpiredSessions();

      const stmt = this.db.prepare('SELECT token, username, created_at, last_accessed, expires_at FROM sessions WHERE token = ? AND expires_at > datetime("now")');
      const result = await stmt.bind(token).first();

      if (!result) return null;

      // 更新最后访问时间（异步，不阻塞请求）
      this.db.prepare('UPDATE sessions SET last_accessed = CURRENT_TIMESTAMP WHERE token = ?').bind(token).run().catch(err => console.error('Error updating last accessed:', err));

      return {
        username: result.username,
        createdAt: result.created_at,
        lastAccessed: result.last_accessed
      };
    } catch (error) {
      console.error('Error getting session from D1:', error);
      return null;
    }
  }

  async updateSession(token, updateData) {
    try {
      const stmt = this.db.prepare('UPDATE sessions SET last_accessed = CURRENT_TIMESTAMP WHERE token = ?');
      const result = await stmt.bind(token).run();

      return result.meta.changes > 0;
    } catch (error) {
      console.error('Error updating session in D1:', error);
      return false;
    }
  }

  async deleteSession(token) {
    try {
      const stmt = this.db.prepare('DELETE FROM sessions WHERE token = ?');
      const result = await stmt.bind(token).run();

      const deleted = result.meta.changes > 0;
      console.log(`${deleted ? 'Deleted' : 'Not found'} session in D1: ${token.substring(0, 8)}...`);
      return deleted;
    } catch (error) {
      console.error('Error deleting session from D1:', error);
      return false;
    }
  }

  async cleanupExpiredSessions() {
    try {
      const stmt = this.db.prepare('DELETE FROM sessions WHERE expires_at <= datetime("now")');
      const result = await stmt.run();

      if (result.meta.changes > 0) {
        console.log(`Cleaned up ${result.meta.changes} expired sessions from D1`);
      }

      return result.meta.changes;
    } catch (error) {
      console.error('Error cleaning up sessions in D1:', error);
      return 0;
    }
  }

  // 数据库统计和监控
  async getStats() {
    try {
      const postsResult = await this.db.prepare('SELECT COUNT(*) as total_posts FROM posts').first();

      const sessionsResult = await this.db.prepare('SELECT COUNT(*) as active_sessions FROM sessions WHERE expires_at > datetime("now")').first();

      const expiredResult = await this.db.prepare('SELECT COUNT(*) as expired_sessions FROM sessions WHERE expires_at <= datetime("now")').first();

      return {
        posts: {
          total: parseInt(postsResult.total_posts)
        },
        sessions: {
          active: parseInt(sessionsResult.active_sessions),
          expired: parseInt(expiredResult.expired_sessions)
        },
        database: {
          type: 'cloudflare_d1'
        }
      };
    } catch (error) {
      console.error('Error getting D1 stats:', error);
      return null;
    }
  }

  // 健康检查
  async healthCheck() {
    try {
      await this.db.prepare('SELECT 1 as health').first();

      return {
        status: 'healthy',
        database: 'cloudflare_d1',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Neon PostgreSQL 适配层
export class NeonDatabase {
  constructor(env) {
    this.env = env;
    this.connectionString = env.DATABASE_URL;
    this.pool = null;
  }

  async initialize() {
    try {
      console.log('Initializing Neon PostgreSQL connection...');
      
      // 动态导入 pg 库
      const { Pool } = await import('pg');
      
      this.pool = new Pool({
        connectionString: this.connectionString,
        ssl: { rejectUnauthorized: false },
        max: 20, // 连接池大小
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000,
      });

      // 测试连接
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      
      console.log('Neon PostgreSQL initialized successfully');
      
      // 初始化数据库表结构
      await this.initializeTables();
    } catch (error) {
      console.error('Failed to initialize Neon database:', error);
      throw error;
    }
  }

  async initializeTables() {
    const client = await this.pool.connect();
    try {
      // 创建文章表
      await client.query(`
        CREATE TABLE IF NOT EXISTS posts (
          id VARCHAR(50) PRIMARY KEY,
          title VARCHAR(200),
          content TEXT,
          tags TEXT[],
          date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      // 创建会话表
      await client.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          token VARCHAR(100) PRIMARY KEY,
          username VARCHAR(50) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          expires_at TIMESTAMP WITH TIME ZONE,
          INDEX idx_expires_at (expires_at),
          INDEX idx_username (username)
        )
      `);

      // 创建索引优化查询性能
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (date DESC)
      `);

      console.log('Database tables initialized');
    } catch (error) {
      console.error('Error initializing tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // 文章相关操作
  async getAllPosts() {
    const startTime = Date.now();
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT id, title, content, tags, date, updated_at as "updatedAt"
        FROM posts 
        ORDER BY date DESC
      `);
      
      const duration = Date.now() - startTime;
      console.log(`Fetched ${result.rows.length} posts from Neon in ${duration}ms`);
      
      return result.rows.map(row => ({
        ...row,
        tags: row.tags || []
      }));
    } catch (error) {
      console.error('Error getting all posts:', error);
      return [];
    } finally {
      client.release();
    }
  }

  async getPost(postId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        SELECT id, title, content, tags, date, updated_at as "updatedAt"
        FROM posts 
        WHERE id = $1
      `, [postId]);
      
      if (result.rows.length === 0) return null;
      
      return {
        ...result.rows[0],
        tags: result.rows[0].tags || []
      };
    } catch (error) {
      console.error('Error getting post:', error);
      return null;
    } finally {
      client.release();
    }
  }

  async createPost(postData) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        INSERT INTO posts (id, title, content, tags, date)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `, [postData.id, postData.title || '', postData.content, postData.tags || [], postData.date]);
      
      console.log('Created post:', result.rows[0].id);
      return result.rows[0];
    } catch (error) {
      console.error('Error creating post:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePost(postId, updateData) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        UPDATE posts 
        SET title = $1, content = $2, tags = $3, updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `, [updateData.title || '', updateData.content, updateData.tags || [], postId]);
      
      if (result.rows.length === 0) return null;
      
      console.log('Updated post:', postId);
      return {
        ...result.rows[0],
        tags: result.rows[0].tags || []
      };
    } catch (error) {
      console.error('Error updating post:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  async deletePost(postId) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM posts WHERE id = $1
        RETURNING id
      `, [postId]);
      
      const deleted = result.rows.length > 0;
      console.log(`${deleted ? 'Deleted' : 'Not found'} post: ${postId}`);
      return deleted;
    } catch (error) {
      console.error('Error deleting post:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // 会话相关操作
  async createSession(token, username, expiresIn = 604800) {
    const client = await this.pool.connect();
    try {
      const expiresAt = new Date(Date.now() + expiresIn * 1000);
      
      await client.query(`
        INSERT INTO sessions (token, username, expires_at)
        VALUES ($1, $2, $3)
      `, [token, username, expiresAt]);
      
      console.log('Created session for user:', username);
      return true;
    } catch (error) {
      console.error('Error creating session:', error);
      return false;
    } finally {
      client.release();
    }
  }

  async getSession(token) {
    const client = await this.pool.connect();
    try {
      // 清理过期会话
      await this.cleanupExpiredSessions(client);
      
      const result = await client.query(`
        SELECT token, username, created_at, last_accessed, expires_at
        FROM sessions 
        WHERE token = $1 AND expires_at > NOW()
      `, [token]);
      
      if (result.rows.length === 0) return null;
      
      const session = result.rows[0];
      
      // 更新最后访问时间（异步，不阻塞请求）
      client.query(`
        UPDATE sessions 
        SET last_accessed = NOW() 
        WHERE token = $1
      `, [token]).catch(err => console.error('Error updating last accessed:', err));
      
      return {
        username: session.username,
        createdAt: session.created_at,
        lastAccessed: session.last_accessed
      };
    } catch (error) {
      console.error('Error getting session:', error);
      return null;
    } finally {
      client.release();
    }
  }

  async updateSession(token, updateData) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        UPDATE sessions 
        SET last_accessed = NOW()
        WHERE token = $1
        RETURNING *
      `, [token]);
      
      return result.rows.length > 0;
    } catch (error) {
      console.error('Error updating session:', error);
      return false;
    } finally {
      client.release();
    }
  }

  async deleteSession(token) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`
        DELETE FROM sessions WHERE token = $1
        RETURNING token
      `, [token]);
      
      const deleted = result.rows.length > 0;
      console.log(`${deleted ? 'Deleted' : 'Not found'} session: ${token.substring(0, 8)}...`);
      return deleted;
    } catch (error) {
      console.error('Error deleting session:', error);
      return false;
    } finally {
      client.release();
    }
  }

  async cleanupExpiredSessions(client = null) {
    const shouldReleaseClient = !client;
    
    if (shouldReleaseClient) {
      client = await this.pool.connect();
    }
    
    try {
      const result = await client.query(`
        DELETE FROM sessions 
        WHERE expires_at <= NOW()
        RETURNING token
      `);
      
      if (result.rows.length > 0) {
        console.log(`Cleaned up ${result.rows.length} expired sessions`);
      }
      
      return result.rows.length;
    } catch (error) {
      console.error('Error cleaning up sessions:', error);
      return 0;
    } finally {
      if (shouldReleaseClient) {
        client.release();
      }
    }
  }

  // 数据库统计和监控
  async getStats() {
    const client = await this.pool.connect();
    try {
      const postsResult = await client.query(`
        SELECT COUNT(*) as total_posts FROM posts
      `);
      
      const sessionsResult = await client.query(`
        SELECT COUNT(*) as active_sessions 
        FROM sessions 
        WHERE expires_at > NOW()
      `);
      
      const expiredResult = await client.query(`
        SELECT COUNT(*) as expired_sessions 
        FROM sessions 
        WHERE expires_at <= NOW()
      `);
      
      return {
        posts: {
          total: parseInt(postsResult.rows[0].total_posts)
        },
        sessions: {
          active: parseInt(sessionsResult.rows[0].active_sessions),
          expired: parseInt(expiredResult.rows[0].expired_sessions)
        },
        database: {
          connected: this.pool.totalCount || 0,
          idle: this.pool.idleCount || 0,
          waiting: this.pool.waitingCount || 0
        }
      };
    } catch (error) {
      console.error('Error getting stats:', error);
      return null;
    } finally {
      client.release();
    }
  }

  // 关闭连接池
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log('Neon PostgreSQL connection closed');
    }
  }

  // 健康检查
  async healthCheck() {
    try {
      const client = await this.pool.connect();
      const result = await client.query('SELECT 1 as health');
      client.release();
      
      return {
        status: 'healthy',
        database: 'neon_postgresql',
        timestamp: new Date().toISOString(),
        connected: this.pool.totalCount || 0
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// 数据库适配器工厂
export function createDatabaseAdapter(env) {
  // 根据环境变量选择数据库类型
  const dbType = env.DATABASE_TYPE || 'kv';

  switch (dbType.toLowerCase()) {
    case 'd1':
      if (env.POSTS_D1) {
        console.log('Using Cloudflare D1 adapter');
        return new D1Database(env);
      } else {
        console.warn('POSTS_D1 binding not found, falling back to KV');
        return null;
      }

    case 'neon':
    case 'postgresql':
      console.log('Using Neon PostgreSQL adapter');
      return new NeonDatabase(env);

    case 'kv':
    default:
      console.log('Using KV fallback adapter');
      return null; // 将使用现有的 KV 逻辑
  }
}

// 数据库操作包装器
export class DatabaseWrapper {
  constructor(env) {
    this.adapter = createDatabaseAdapter(env);
    this.env = env;
  }

  async initialize() {
    if (this.adapter) {
      try {
        await this.adapter.initialize();
      } catch (error) {
        console.error('Database adapter initialization failed:', error);
        // 不抛出错误，允许系统回退到 KV
      }
    }
  }

  // 自动路由到合适的数据库
  async getAllPosts() {
    if (this.adapter) {
      return await this.adapter.getAllPosts();
    }
    // 回退到 KV
    const { getAllPosts } = await import('./utils.js');
    return await getAllPosts(this.env.POSTS_KV);
  }

  async getPost(postId) {
    if (this.adapter) {
      return await this.adapter.getPost(postId);
    }
    // 回退到 KV
    const postData = await this.env.POSTS_KV.get(`post:${postId}`, 'json');
    return postData;
  }

  async createPost(postData) {
    if (this.adapter) {
      return await this.adapter.createPost(postData);
    }
    // 回退到 KV
    await this.env.POSTS_KV.put(`post:${postData.id}`, JSON.stringify(postData));
    return postData;
  }

  async updatePost(postId, updateData) {
    if (this.adapter) {
      return await this.adapter.updatePost(postId, updateData);
    }
    // 回退到 KV
    const existingPost = await this.env.POSTS_KV.get(`post:${postId}`, 'json');
    if (!existingPost) return null;
    
    const updatedPost = { ...existingPost, ...updateData, updatedAt: new Date().toISOString() };
    await this.env.POSTS_KV.put(`post:${postId}`, JSON.stringify(updatedPost));
    return updatedPost;
  }

  async deletePost(postId) {
    if (this.adapter) {
      return await this.adapter.deletePost(postId);
    }
    // 回退到 KV
    await this.env.POSTS_KV.delete(`post:${postId}`);
    return true;
  }

  async getSession(token) {
    if (this.adapter) {
      return await this.adapter.getSession(token);
    }
    // 回退到 KV
    const { verifySession } = await import('./utils.js');
    const result = await verifySession(
      { headers: { get: () => `session=${token}` } },
      this.env
    );
    return result.valid ? { username: result.username } : null;
  }

  async getStats() {
    if (this.adapter) {
      return await this.adapter.getStats();
    }
    
    // KV 统计
    try {
      const list = await this.env.POSTS_KV.list({ prefix: 'post:' });
      const sessionList = await this.env.POSTS_KV.list({ prefix: 'session:' });
      
      return {
        posts: { total: list.keys.length },
        sessions: { 
          active: sessionList.keys.length,
          expired: 'unknown'
        },
        database: { type: 'cloudflare_kv' }
      };
    } catch (error) {
      console.error('Error getting KV stats:', error);
      return null;
    }
  }
}