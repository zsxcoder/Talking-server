// 会话更新缓存，避免频繁 KV 写入
const sessionUpdateCache = new Map();

export async function verifySession(request, env) {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) {
    console.log('No cookie header found');
    return false;
  }

  // 更健壮的 Cookie 解析
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [key, ...values] = cookie.trim().split('=');
    if (key && values.length > 0) {
      cookies[key] = values.join('=');
    }
  });

  const sessionToken = cookies.session;
  if (!sessionToken) {
    console.log('No session token in cookies');
    return false;
  }

  console.log('Found session token:', sessionToken.substring(0, 8) + '...');

  // 检查是否需要更新会话（每30分钟更新一次）
  const now = Date.now();
  const lastUpdate = sessionUpdateCache.get(sessionToken) || 0;
  const shouldUpdate = now - lastUpdate > 30 * 60 * 1000; // 30分钟

  // 验证会话令牌的有效性
  try {
    // 从 KV 中验证会话信息
    const sessionData = await env.POSTS_KV.get(`session:${sessionToken}`, 'json');
    if (sessionData && sessionData.username) {
      // 检查用户是否仍在管理员列表中
      const adminUsers = JSON.parse(env.ADMIN_USERS);
      if (adminUsers.includes(sessionData.username)) {
        console.log('Session valid for user:', sessionData.username);
        
        // 只有在需要时才更新 KV
        if (shouldUpdate) {
          console.log('Updating session timestamp');
          sessionUpdateCache.set(sessionToken, now);
          
          try {
            // 更新 KV 中的会话有效期
            await env.POSTS_KV.put(`session:${sessionToken}`, JSON.stringify({
              username: sessionData.username,
              createdAt: sessionData.createdAt,
              lastAccessed: now
            }), {
              expirationTtl: 604800 // 7 天
            });
          } catch (updateError) {
            console.error('Error updating session:', updateError);
          }
        }
        
        return { valid: true, username: sessionData.username, needsCookieUpdate: shouldUpdate };
      } else {
        console.log('User not in admin list:', sessionData.username);
      }
    } else {
      console.log('No session data found or invalid format');
    }
  } catch (error) {
    console.error('Session verification error:', error);
  }
  
  return false;
}

// 简单的内存缓存实现
const postCache = {
  data: null,
  timestamp: 0,
  ttl: 5 * 60 * 1000, // 5分钟缓存
};

export async function getAllPosts(kv) {
  const now = Date.now();

  // 检查缓存是否有效
  if (postCache.data && (now - postCache.timestamp) < postCache.ttl) {
    console.log('Returning cached posts, age:', (now - postCache.timestamp) / 1000, 'seconds');
    return postCache.data;
  }

  console.log('Fetching fresh posts from KV');
  const list = await kv.list({ prefix: 'post:' });
  const posts = [];

  // 使用 Promise.all 并行获取所有文章数据
  const promises = list.keys.map(async key => {
    const postData = await kv.get(key.name, 'json');
    return postData;
  });

  const results = await Promise.all(promises);

  // 过滤掉 null 值并添加到数组
  results.forEach(postData => {
    if (postData) {
      posts.push(postData);
    }
  });

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

  // 更新缓存
  postCache.data = posts;
  postCache.timestamp = now;

  console.log('Fetched', posts.length, 'posts from KV');
  return posts;
}

// 清除文章缓存
export function clearPostsCache() {
  postCache.data = null;
  postCache.timestamp = 0;
  console.log('Posts cache cleared');
}