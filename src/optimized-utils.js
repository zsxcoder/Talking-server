import { AdvancedKVCache, BatchOperationOptimizer, SessionManager, KVPerformanceMonitor } from './cache-optimizer.js';

// 全局缓存实例
let postsCache = null;
let sessionManager = null;
let performanceMonitor = null;

// 初始化优化工具
export function initializeOptimizations(env) {
  if (!postsCache) {
    postsCache = new AdvancedKVCache(env, {
      ttl: 5 * 60 * 1000, // 5分钟
      maxSize: 50 // 最多缓存50篇文章
    });
  }

  if (!sessionManager) {
    sessionManager = new SessionManager(env);
  }

  if (!performanceMonitor) {
    performanceMonitor = new KVPerformanceMonitor();
  }

  console.log('Optimization tools initialized');
}

// 优化后的文章获取函数
export async function getAllPostsOptimized(env) {
  const startTime = Date.now();
  
  if (!postsCache) {
    console.warn('Cache not initialized, using fallback');
    initializeOptimizations(env);
  }

  // 使用缓存
  const cacheKey = 'all_posts';
  let posts = await postsCache.get(cacheKey);
  
  if (!posts) {
    console.log('Cache miss, fetching from KV');
    
    // 使用批量操作获取文章
    const batchOptimizer = new BatchOperationOptimizer(env);
    const list = await env.POSTS_KV.list({ prefix: 'post:' });
    
    // 并行获取所有文章
    const keys = list.keys.map(k => k.name);
    const results = await batchOptimizer.batchGet(keys);
    
    // 转换为数组并排序
    posts = Object.values(results)
      .filter(post => post && post.id && post.date)
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // 缓存结果
    await postsCache.set(cacheKey, posts);
  }

  const duration = Date.now() - startTime;
  performanceMonitor?.logOperation('get_all_posts', 'posts_list', duration, true);
  
  console.log(`Got ${posts.length} posts in ${duration}ms`);
  return posts;
}

// 优化后的会话验证函数
export async function verifySessionOptimized(request, env) {
  if (!sessionManager) {
    console.warn('Session manager not initialized, using fallback');
    initializeOptimizations(env);
  }

  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    performanceMonitor?.logOperation('verify_session', 'no_cookie', 0, false);
    return false;
  }

  // 解析Cookie
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [key, ...values] = cookie.trim().split('=');
    if (key && values.length > 0) {
      cookies[key] = values.join('=');
    }
  });

  const sessionToken = cookies.session;
  if (!sessionToken) {
    performanceMonitor?.logOperation('verify_session', 'no_token', 0, false);
    return false;
  }

  const startTime = Date.now();
  
  try {
    // 从 KV 获取会话数据
    const sessionData = await env.POSTS_KV.get(`session:${sessionToken}`, 'json');
    
    if (sessionData && sessionData.username) {
      const adminUsers = JSON.parse(env.ADMIN_USERS);
      if (adminUsers.includes(sessionData.username)) {
        // 延迟更新会话时间戳
        await sessionManager.updateSession(sessionToken, sessionData);
        
        const duration = Date.now() - startTime;
        performanceMonitor?.logOperation('verify_session', sessionToken.substring(0, 8), duration, true);
        
        return { 
          valid: true, 
          username: sessionData.username,
          needsCookieUpdate: true 
        };
      } else {
        console.log('User not in admin list:', sessionData.username);
      }
    }
  } catch (error) {
    console.error('Session verification error:', error);
  }

  const duration = Date.now() - startTime;
  performanceMonitor?.logOperation('verify_session', sessionToken.substring(0, 8), duration, false);
  return false;
}

// 批量操作示例
export async function batchUpdatePosts(env, updates) {
  const startTime = Date.now();
  
  if (!updates || updates.length === 0) {
    return { success: 0, total: 0 };
  }

  const batchOptimizer = new BatchOperationOptimizer(env);
  const promises = updates.map(async ({ id, data }) => {
    const key = `post:${id}`;
    const value = JSON.stringify(data);
    return batchOptimizer.set(key, value);
  });

  const results = await Promise.all(promises);
  const successCount = results.filter(r => r).length;
  
  const duration = Date.now() - startTime;
  performanceMonitor?.logOperation('batch_update_posts', `${updates.length}_posts`, duration, successCount === updates.length);
  
  console.log(`Batch update: ${successCount}/${updates.length} successful in ${duration}ms`);
  
  return {
    success: successCount,
    total: updates.length,
    duration
  };
}

// 获取性能统计
export function getPerformanceStats() {
  const cacheStats = postsCache?.getStats();
  const monitorStats = performanceMonitor?.getStats();
  const sessionStats = await sessionManager?.getStats();
  
  return {
    cache: cacheStats || { hitRate: '0%', hits: 0, misses: 0 },
    performance: monitorStats || { successRate: '0%', averageDuration: '0ms' },
    sessions: sessionStats || { totalSessions: 0, pendingUpdates: 0 },
    timestamp: new Date().toISOString()
  };
}

// 清理缓存
export function clearAllCaches() {
  postsCache?.clear();
  performanceMonitor?.clear();
  console.log('All caches cleared');
}

// 使用指南和迁移步骤
export const MigrationGuide = {
  // 第一步：替换现有的导入
  step1: `
    在 admin.js 中：
    将 import { getAllPosts } from './utils.js';
    改为 import { getAllPostsOptimized } from './optimized-utils.js';
    
    在 public.js 中：
    将 import { getAllPosts } from './utils.js';
    改为 import { getAllPostsOptimized } from './optimized-utils.js';
  `,

  // 第二步：初始化优化工具
  step2: `
    在 index.js 的主要处理函数开始处添加：
    import { initializeOptimizations } from './optimized-utils.js';
    
    // 在处理请求之前调用
    initializeOptimizations(env);
  `,

  // 第三步：替换函数调用
  step3: `
    将所有 getAllPosts(env.POSTS_KV) 调用
    改为 getAllPostsOptimized(env)
  `,

  // 第四步：可选的会话优化
  step4: `
    将 verifySession 调用
    改为 verifySessionOptimized
  `,

  // 第五步：监控性能
  step5: `
    添加性能统计端点：
    export async function handleStats(request, env) {
      const stats = getPerformanceStats();
      return new Response(JSON.stringify(stats), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  `
};