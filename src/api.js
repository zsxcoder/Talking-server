export async function handleAPI(request, env, dbWrapper = null) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 设置 CORS 头
  const corsHeaders = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // 处理 OPTIONS 预检请求
  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 获取所有文章
    if (path === '/api/posts' && method === 'GET') {
      const { getAllPosts } = await import('./utils.js');
      const posts = dbWrapper
        ? await dbWrapper.getAllPosts()
        : await getAllPosts(env.POSTS_KV);

      return new Response(JSON.stringify({
        success: true,
        data: posts,
        count: posts.length
      }), {
        headers: corsHeaders,
      });
    }

    // 获取单篇文章
    if (path.startsWith('/api/posts/') && method === 'GET') {
      const postId = path.split('/').pop();

      if (dbWrapper) {
        const post = await dbWrapper.getPost(postId);
        if (!post) {
          return new Response(JSON.stringify({
            success: false,
            error: '文章不存在'
          }), {
            status: 404,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify({
          success: true,
          data: post
        }), {
          headers: corsHeaders,
        });
      } else {
        const postData = await env.POSTS_KV.get(`post:${postId}`, 'json');
        if (!postData) {
          return new Response(JSON.stringify({
            success: false,
            error: '文章不存在'
          }), {
            status: 404,
            headers: corsHeaders,
          });
        }
        return new Response(JSON.stringify({
          success: true,
          data: postData
        }), {
          headers: corsHeaders,
        });
      }
    }

    // 获取统计数据
    if (path === '/api/stats' && method === 'GET') {
      const { getAllPosts } = await import('./utils.js');
      const posts = dbWrapper
        ? await dbWrapper.getAllPosts()
        : await getAllPosts(env.POSTS_KV);

      return new Response(JSON.stringify({
        success: true,
        data: {
          total_posts: posts.length,
          api_version: '1.0.0'
        }
      }), {
        headers: corsHeaders,
      });
    }

    // API 健康检查
    if (path === '/api/health' && method === 'GET') {
      return new Response(JSON.stringify({
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          database_type: dbWrapper ? 'd1' : 'kv'
        }
      }), {
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({
      success: false,
      error: '未找到指定的 API 端点'
    }), {
      status: 404,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('API Error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: corsHeaders,
    });
  }
}
