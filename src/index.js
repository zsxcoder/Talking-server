import { handleAuth } from './auth.js';
import { handleAPI } from './api.js';
import { handleAdmin } from './admin.js';
import { handlePublic } from './public.js';
import { DatabaseWrapper } from './database.js';

// 全局数据库实例（避免重复初始化）
let dbWrapper = null;

// 初始化数据库连接
async function initializeDatabase(env) {
  if (!dbWrapper) {
    dbWrapper = new DatabaseWrapper(env);
    await dbWrapper.initialize();
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 添加 CORS 头，确保跨域请求正常工作
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
    
    // 处理 OPTIONS 请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    try {
      // 初始化数据库（如果尚未初始化）
      await initializeDatabase(env);
      
      // 路由处理
      if (path.startsWith('/auth')) {
        return handleAuth(request, env, dbWrapper);
      }
      
      if (path.startsWith('/api')) {
        return handleAPI(request, env, dbWrapper);
      }
      
      if (path.startsWith('/admin')) {
        return handleAdmin(request, env, dbWrapper);
      }
      
      return handlePublic(request, env, dbWrapper);
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(`服务器错误: ${error.message}`, { 
        status: 500,
        headers: corsHeaders
      });
    }
  }
};