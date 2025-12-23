// 高性能缓存和 KV 优化方案
export class AdvancedKVCache {
  constructor(env, options = {}) {
    this.env = env;
    this.cache = new Map();
    this.ttl = options.ttl || 5 * 60 * 1000; // 默认5分钟
    this.maxSize = options.maxSize || 100;
    this.hitCount = 0;
    this.missCount = 0;
  }

  async get(key, type = 'json') {
    // 检查缓存
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      this.hitCount++;
      console.log(`Cache HIT for key: ${key}`);
      return cached.data;
    }

    this.missCount++;
    console.log(`Cache MISS for key: ${key}`);
    
    // 从 KV 获取并缓存
    const data = await this.env.POSTS_KV.get(key, type);
    
    // 检查缓存大小
    if (this.cache.size >= this.maxSize) {
      // 清理最旧的缓存项
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    return data;
  }

  async set(key, value, options = {}) {
    await this.env.POSTS_KV.put(key, value, options);
    
    // 更新缓存
    this.cache.set(key, {
      data: typeof value === 'string' ? value : JSON.parse(value),
      timestamp: Date.now()
    });
  }

  async delete(key) {
    await this.env.POSTS_KV.delete(key);
    this.cache.delete(key);
  }

  getStats() {
    const total = this.hitCount + this.missCount;
    return {
      hitRate: total > 0 ? ((this.hitCount / total) * 100).toFixed(2) + '%' : '0%',
      hits: this.hitCount,
      misses: this.missCount,
      cacheSize: this.cache.size
    };
  }

  clear() {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }
}

// 批量操作优化类
export class BatchOperationOptimizer {
  constructor(env) {
    this.env = env;
  }

  async batchGet(keys) {
    console.log(`Batch getting ${keys.length} keys`);
    
    // 并行获取所有键
    const promises = keys.map(async (key, index) => {
      try {
        const result = await this.env.POSTS_KV.get(key, 'json');
        return { key, index, data: result, success: true };
      } catch (error) {
        console.error(`Error getting key ${key}:`, error);
        return { key, index, error, success: false };
      }
    });

    const results = await Promise.all(promises);
    
    // 将结果转换为键值映射
    const keyValueMap = {};
    results.forEach(({ key, data, success }) => {
      if (success && data) {
        keyValueMap[key] = data;
      }
    });

    return keyValueMap;
  }

  async batchSet(entries, options = {}) {
    console.log(`Batch setting ${entries.length} entries`);
    
    const promises = entries.map(async ({ key, value }) => {
      try {
        await this.env.POSTS_KV.put(key, value, options);
        return { key, success: true };
      } catch (error) {
        console.error(`Error setting key ${key}:`, error);
        return { key, error, success: false };
      }
    });

    const results = await Promise.all(promises);
    
    return results.filter(r => r.success).length;
  }
}

// 会话管理优化器
export class SessionManager {
  constructor(env) {
    this.env = env;
    this.pendingUpdates = new Map();
    this.updateQueue = [];
    this.batchSize = 10;
    this.updateDelay = 30000; // 30秒
  }

  async updateSession(sessionToken, sessionData) {
    // 防止重复更新
    if (this.pendingUpdates.has(sessionToken)) {
      console.log(`Session ${sessionToken.substring(0, 8)}... update already pending`);
      return;
    }

    this.pendingUpdates.set(sessionToken, true);
    this.updateQueue.push({ sessionToken, sessionData });

    // 批量处理更新
    if (this.updateQueue.length >= this.batchSize) {
      await this.processBatch();
    } else {
      this.scheduleBatch();
    }
  }

  scheduleBatch() {
    // 清除之前的定时器
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // 设置新的定时器
    this.batchTimer = setTimeout(() => {
      if (this.updateQueue.length > 0) {
        this.processBatch();
      }
    }, this.updateDelay);
  }

  async processBatch() {
    if (this.updateQueue.length === 0) return;

    const batch = this.updateQueue.splice(0, this.batchSize);
    console.log(`Processing batch of ${batch.length} session updates`);

    try {
      const promises = batch.map(({ sessionToken, sessionData }) => {
        const key = `session:${sessionToken}`;
        const value = JSON.stringify({
          ...sessionData,
          lastAccessed: Date.now()
        });

        return this.env.POSTS_KV.put(key, value, {
          expirationTtl: 604800 // 7 days
        });
      });

      await Promise.all(promises);
      
      // 清除待更新标记
      batch.forEach(({ sessionToken }) => {
        this.pendingUpdates.delete(sessionToken);
      });

      console.log(`Successfully updated ${batch.length} sessions`);
    } catch (error) {
      console.error('Batch session update failed:', error);
      
      // 重新入队失败的更新
      this.updateQueue.unshift(...batch);
    }
  }

  async getStats() {
    try {
      const list = await this.env.POSTS_KV.list({ prefix: 'session:' });
      return {
        totalSessions: list.keys.length,
        pendingUpdates: this.updateQueue.length,
        pendingInCache: this.pendingUpdates.size
      };
    } catch (error) {
      console.error('Error getting session stats:', error);
      return null;
    }
  }
}

// 替代方案：使用 Durable Objects 进行会话管理
export class DurableSessionStore {
  constructor(durableObject) {
    this.durable = durableObject;
  }

  async get(sessionToken) {
    const id = this.env.DURABLE_SESSION.idFromName(sessionToken);
    const stub = this.env.DURABLE_SESSION.get(id);
    return await stub.get('sessionData');
  }

  async set(sessionToken, sessionData, ttl = 604800) {
    const id = this.env.DURABLE_SESSION.idFromName(sessionToken);
    const stub = this.env.DURABLE_SESSION.get(id);
    
    await stub.put('sessionData', sessionData, {
      // Durable Objects 不需要 TTL，可以手动管理
    });
  }

  async delete(sessionToken) {
    const id = this.env.DURABLE_SESSION.idFromName(sessionToken);
    const stub = this.env.DURABLE_SESSION.get(id);
    await stub.delete('sessionData');
  }

  async cleanup() {
    // 清理过期的会话
    const list = await this.env.DURABLE_SESSION.list();
    const now = Date.now();
    const expiredThreshold = 7 * 24 * 60 * 60 * 1000; // 7天

    const promises = list.map(async ({ name }) => {
      const sessionData = await this.get(name);
      if (sessionData && sessionData.createdAt) {
        if (now - sessionData.createdAt > expiredThreshold) {
          await this.delete(name);
        }
      }
    });

    await Promise.all(promises);
  }
}

// 性能监控工具
export class KVPerformanceMonitor {
  constructor() {
    this.operations = [];
    this.startTime = Date.now();
  }

  logOperation(type, key, duration, success = true) {
    this.operations.push({
      type,
      key: key.substring(0, 20) + (key.length > 20 ? '...' : ''),
      duration,
      success,
      timestamp: Date.now()
    });

    // 保持最近1000条操作记录
    if (this.operations.length > 1000) {
      this.operations = this.operations.slice(-1000);
    }
  }

  getStats() {
    const recentOps = this.operations.slice(-100); // 最近100个操作
    const successfulOps = recentOps.filter(op => op.success);
    const failedOps = recentOps.filter(op => !op.success);

    const avgDuration = successfulOps.reduce((sum, op) => sum + op.duration, 0) / successfulOps.length;

    return {
      totalOperations: this.operations.length,
      recentOperations: recentOps.length,
      successRate: recentOps.length > 0 ? ((successfulOps.length / recentOps.length) * 100).toFixed(2) + '%' : '0%',
      averageDuration: avgDuration.toFixed(2) + 'ms',
      failedOperations: failedOps.length,
      uptime: ((Date.now() - this.startTime) / 1000 / 60).toFixed(2) + 'min'
    };
  }

  clear() {
    this.operations = [];
    this.startTime = Date.now();
  }
}

// 使用示例和集成指南
export const OptimizationGuide = {
  // 立即优化（低风险）
  immediateOptimizations: [
    '实现简单内存缓存',
    '减少不必要的 KV 写入',
    '使用 Promise.all 并行获取'
  ],

  // 中期优化（中等风险）
  mediumTermOptimizations: [
    '实现批量操作',
    '添加会话更新队列',
    '实施性能监控'
  ],

  // 长期优化（需要架构变更）
  longTermOptimizations: [
    '迁移到 Durable Objects 进行会话管理',
    '实现分布式缓存',
    '添加 CDN 边缘缓存'
  ],

  // 预期性能提升
  expectedGains: {
    'KV 读取减少': '60-80%',
    'KV 写入减少': '40-60%',
    '响应时间减少': '100-300ms',
    '缓存命中率': '70-90%'
  }
};