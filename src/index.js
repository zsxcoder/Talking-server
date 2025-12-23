import { handleAuth } from './auth.js';
import { handleAPI } from './api.js';
import { handleAdmin } from './admin.js';
import { handlePublic } from './public.js';

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
      // 路由处理
      if (path.startsWith('/auth')) {
        return handleAuth(request, env);
      }
      
      if (path.startsWith('/api')) {
        return handleAPI(request, env);
      }
      
      if (path.startsWith('/admin')) {
        return handleAdmin(request, env);
      }
      
      return handlePublic(request, env);
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response(`服务器错误: ${error.message}`, { 
        status: 500,
        headers: corsHeaders
      });
    }
  }
};