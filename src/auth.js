export async function handleAuth(request, env, dbWrapper = null) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/auth/login') {
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&scope=user:email`;
    return Response.redirect(githubAuthUrl);
  }

  if (path === '/auth/callback') {
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    
    if (error) {
      console.error('GitHub OAuth error:', error);
      return new Response(`GitHub授权错误: ${error}`, { status: 400 });
    }
    
    if (!code) {
      return new Response('授权失败：未收到授权码', { status: 400 });
    }

    try {
      console.log('Getting access token with code:', code);
      
      // 获取访问令牌
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code: code,
        }),
      });

      const tokenData = await tokenResponse.json();
      console.log('Token response:', tokenData);
      
      if (tokenData.error) {
        console.error('Token error:', tokenData);
        return new Response(`获取令牌失败: ${tokenData.error_description || tokenData.error}`, { status: 400 });
      }
      
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return new Response('获取访问令牌失败', { status: 400 });
      }

      // 获取用户信息
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${accessToken}`,
          'User-Agent': 'Social-Moments-App',
        },
      });

      if (!userResponse.ok) {
        console.error('User API error:', userResponse.status, userResponse.statusText);
        return new Response('获取用户信息失败', { status: 400 });
      }

      const userData = await userResponse.json();
      console.log('User data:', userData);
      const username = userData.login;

      // 检查是否为管理员
      const adminUsers = JSON.parse(env.ADMIN_USERS);
      console.log('Admin users:', adminUsers, 'Current user:', username);
      
      if (!adminUsers.includes(username)) {
        return new Response(`无权限访问。当前用户: ${username}`, { status: 403 });
      }

      // 创建会话令牌
      const sessionToken = await generateSessionToken(username);

      // 将会话信息存储到数据库中
      if (dbWrapper && dbWrapper.adapter) {
        await dbWrapper.adapter.createSession(sessionToken, username);
      } else {
        // 回退到 KV
        await env.POSTS_KV.put(`session:${sessionToken}`, JSON.stringify({
          username: username,
          createdAt: Date.now(),
          lastAccessed: Date.now()
        }), {
          expirationTtl: 604800 // 7 天后过期
        });
      }

      const baseUrl = `${url.protocol}//${url.host}`;
      return new Response(null, {
        status: 302,
        headers: {
          'Location': `${baseUrl}/admin`,
          'Set-Cookie': `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/;`
        }
      });

    } catch (error) {
      console.error('Auth error:', error);
      return new Response(`认证失败: ${error.message}`, { status: 500 });
    }
  }

  return new Response('未找到', { status: 404 });
}

async function generateSessionToken(username) {
  const data = JSON.stringify({ username, timestamp: Date.now() });
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
