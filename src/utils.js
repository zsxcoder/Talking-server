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

  // 验证会话令牌的有效性
  try {
    // 从 KV 中验证会话信息
    const sessionData = await env.POSTS_KV.get(`session:${sessionToken}`, 'json');
    if (sessionData && sessionData.username) {
      // 检查用户是否仍在管理员列表中
      const adminUsers = JSON.parse(env.ADMIN_USERS);
      if (adminUsers.includes(sessionData.username)) {
        console.log('Session valid for user:', sessionData.username);
        
        // 扩展会话有效期：每次验证成功后，更新 KV 和 Cookie 的有效期
        try {
          // 更新 KV 中的会话有效期
          await env.POSTS_KV.put(`session:${sessionToken}`, JSON.stringify({
            username: sessionData.username,
            createdAt: sessionData.createdAt,
            lastAccessed: Date.now()
          }), {
            expirationTtl: 604800 // 7 天
          });
          
          // 注意：我们不能直接在这里设置 Cookie，因为这需要在响应中进行
          // 但我们可以通过添加一个特殊的响应头让前端知道需要更新 Cookie
          return { valid: true, username: sessionData.username, needsCookieUpdate: true };
        } catch (updateError) {
          console.error('Error updating session:', updateError);
          // 即使更新失败，会话仍然有效
          return { valid: true, username: sessionData.username, needsCookieUpdate: false };
        }
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

export async function getAllPosts(kv) {
  const list = await kv.list({ prefix: 'post:' });
  const posts = [];

  for (const key of list.keys) {
    const postData = await kv.get(key.name, 'json');
    if (postData) {
      posts.push(postData);
    }
  }

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  return posts;
}