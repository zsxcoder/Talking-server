import { verifySession } from './utils.js';

/**
 * 会话中间件，用于处理认证和会话管理
 * @param {Request} request - 请求对象
 * @param {Object} env - 环境变量
 * @param {Function} handler - 处理函数
 * @param {boolean} requireAuth - 是否需要认证
 * @returns {Promise<Response>} 响应对象
 */
export async function withSession(request, env, handler, requireAuth = true) {
  const url = new URL(request.url);
  
  // 验证会话
  const authResult = await verifySession(request, env);
  const isAuthenticated = typeof authResult === 'boolean' ? authResult : authResult.valid;
  
  // 如果需要认证但未认证，重定向到登录页
  if (requireAuth && !isAuthenticated && url.pathname !== '/admin/login') {
    const baseUrl = `${url.protocol}//${url.host}`;
    return Response.redirect(`${baseUrl}/admin/login`);
  }
  
  // 设置初始响应头
  const headers = {};
  
  // 如果会话有效且需要更新 Cookie
  if (isAuthenticated && typeof authResult === 'object' && authResult.needsCookieUpdate) {
    // 获取当前 session token
    const cookieHeader = request.headers.get('Cookie');
    const cookies = cookieHeader ? cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, ...values] = cookie.trim().split('=');
      if (key && values.length > 0) {
        acc[key] = values.join('=');
      }
      return acc;
    }, {}) : {};
    
    const sessionToken = cookies.session;
    if (sessionToken) {
      headers['Set-Cookie'] = `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/;`;
    }
  }
  
  // 调用处理函数
  let response = await handler(request, env, authResult);
  
  // 如果处理函数返回的是 Response 对象，添加我们的头信息
  if (response instanceof Response) {
    // 合并头信息
    const newHeaders = new Headers(response.headers);
    Object.entries(headers).forEach(([key, value]) => {
      // 只有当响应中还没有这个头信息时才添加
      if (!newHeaders.has(key)) {
        newHeaders.set(key, value);
      }
    });
    
    // 创建新的响应对象，保持原始响应的状态和体
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
  
  return response;
}

/**
 * 创建一个带有会话的 HTML 响应
 * @param {string} html - HTML 内容
 * @param {Object} headers - 额外的头信息
 * @returns {Response} 响应对象
 */
export function createHTMLResponse(html, headers = {}) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...headers
    }
  });
}

/**
 * 创建一个带有会话的重定向响应
 * @param {string} location - 重定向 URL
 * @param {Object} headers - 额外的头信息
 * @returns {Response} 响应对象
 */
export function createRedirectResponse(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      'Location': location,
      ...headers
    }
  });
}