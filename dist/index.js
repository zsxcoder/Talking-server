var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/utils.js
var utils_exports = {};
__export(utils_exports, {
  getAllPosts: () => getAllPosts,
  verifySession: () => verifySession
});
async function verifySession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) {
    console.log("No cookie header found");
    return false;
  }
  const cookies = {};
  cookieHeader.split(";").forEach((cookie) => {
    const [key, ...values] = cookie.trim().split("=");
    if (key && values.length > 0) {
      cookies[key] = values.join("=");
    }
  });
  const sessionToken = cookies.session;
  if (!sessionToken) {
    console.log("No session token in cookies");
    return false;
  }
  console.log("Found session token:", sessionToken.substring(0, 8) + "...");
  const now = Date.now();
  const lastUpdate = sessionUpdateCache.get(sessionToken) || 0;
  const shouldUpdate = now - lastUpdate > 30 * 60 * 1e3;
  try {
    const sessionData = await env.POSTS_KV.get(`session:${sessionToken}`, "json");
    if (sessionData && sessionData.username) {
      const adminUsers = JSON.parse(env.ADMIN_USERS);
      if (adminUsers.includes(sessionData.username)) {
        console.log("Session valid for user:", sessionData.username);
        if (shouldUpdate) {
          console.log("Updating session timestamp");
          sessionUpdateCache.set(sessionToken, now);
          try {
            await env.POSTS_KV.put(`session:${sessionToken}`, JSON.stringify({
              username: sessionData.username,
              createdAt: sessionData.createdAt,
              lastAccessed: now
            }), {
              expirationTtl: 604800
              // 7 天
            });
          } catch (updateError) {
            console.error("Error updating session:", updateError);
          }
        }
        return { valid: true, username: sessionData.username, needsCookieUpdate: shouldUpdate };
      } else {
        console.log("User not in admin list:", sessionData.username);
      }
    } else {
      console.log("No session data found or invalid format");
    }
  } catch (error) {
    console.error("Session verification error:", error);
  }
  return false;
}
async function getAllPosts(kv) {
  const now = Date.now();
  if (postCache.data && now - postCache.timestamp < postCache.ttl) {
    console.log("Returning cached posts, age:", (now - postCache.timestamp) / 1e3, "seconds");
    return postCache.data;
  }
  console.log("Fetching fresh posts from KV");
  const list = await kv.list({ prefix: "post:" });
  const posts = [];
  const promises = list.keys.map(async (key) => {
    const postData = await kv.get(key.name, "json");
    return postData;
  });
  const results = await Promise.all(promises);
  results.forEach((postData) => {
    if (postData) {
      posts.push(postData);
    }
  });
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  postCache.data = posts;
  postCache.timestamp = now;
  console.log("Fetched", posts.length, "posts from KV");
  return posts;
}
var sessionUpdateCache, postCache;
var init_utils = __esm({
  "src/utils.js"() {
    sessionUpdateCache = /* @__PURE__ */ new Map();
    __name(verifySession, "verifySession");
    postCache = {
      data: null,
      timestamp: 0,
      ttl: 5 * 60 * 1e3
      // 5分钟缓存
    };
    __name(getAllPosts, "getAllPosts");
  }
});

// src/auth.js
async function handleAuth(request, env, dbWrapper3 = null) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === "/auth/login") {
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${env.GITHUB_CLIENT_ID}&scope=user:email`;
    return Response.redirect(githubAuthUrl);
  }
  if (path === "/auth/callback") {
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    if (error) {
      console.error("GitHub OAuth error:", error);
      return new Response(`GitHub\u6388\u6743\u9519\u8BEF: ${error}`, { status: 400 });
    }
    if (!code) {
      return new Response("\u6388\u6743\u5931\u8D25\uFF1A\u672A\u6536\u5230\u6388\u6743\u7801", { status: 400 });
    }
    try {
      console.log("Getting access token with code:", code);
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code
        })
      });
      const tokenData = await tokenResponse.json();
      console.log("Token response:", tokenData);
      if (tokenData.error) {
        console.error("Token error:", tokenData);
        return new Response(`\u83B7\u53D6\u4EE4\u724C\u5931\u8D25: ${tokenData.error_description || tokenData.error}`, { status: 400 });
      }
      const accessToken = tokenData.access_token;
      if (!accessToken) {
        return new Response("\u83B7\u53D6\u8BBF\u95EE\u4EE4\u724C\u5931\u8D25", { status: 400 });
      }
      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          "Authorization": `token ${accessToken}`,
          "User-Agent": "Social-Moments-App"
        }
      });
      if (!userResponse.ok) {
        console.error("User API error:", userResponse.status, userResponse.statusText);
        return new Response("\u83B7\u53D6\u7528\u6237\u4FE1\u606F\u5931\u8D25", { status: 400 });
      }
      const userData = await userResponse.json();
      console.log("User data:", userData);
      const username = userData.login;
      const adminUsers = JSON.parse(env.ADMIN_USERS);
      console.log("Admin users:", adminUsers, "Current user:", username);
      if (!adminUsers.includes(username)) {
        return new Response(`\u65E0\u6743\u9650\u8BBF\u95EE\u3002\u5F53\u524D\u7528\u6237: ${username}`, { status: 403 });
      }
      const sessionToken = await generateSessionToken(username);
      if (dbWrapper3) {
        await dbWrapper3.adapter.createSession(sessionToken, username);
      } else {
        await env.POSTS_KV.put(`session:${sessionToken}`, JSON.stringify({
          username,
          createdAt: Date.now(),
          lastAccessed: Date.now()
        }), {
          expirationTtl: 604800
          // 7 天后过期
        });
      }
      const baseUrl = `${url.protocol}//${url.host}`;
      return new Response(null, {
        status: 302,
        headers: {
          "Location": `${baseUrl}/admin`,
          "Set-Cookie": `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/;`
        }
      });
    } catch (error2) {
      console.error("Auth error:", error2);
      return new Response(`\u8BA4\u8BC1\u5931\u8D25: ${error2.message}`, { status: 500 });
    }
  }
  return new Response("\u672A\u627E\u5230", { status: 404 });
}
__name(handleAuth, "handleAuth");
async function generateSessionToken(username) {
  const data = JSON.stringify({ username, timestamp: Date.now() });
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateSessionToken, "generateSessionToken");

// src/api.js
init_utils();
async function handleAPI(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/posts" && request.method === "GET") {
    try {
      const posts = await getAllPosts(env.POSTS_KV);
      return new Response(JSON.stringify({ data: posts }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (error) {
      return new Response("\u83B7\u53D6\u6570\u636E\u5931\u8D25", { status: 500 });
    }
  }
  return new Response("\u672A\u627E\u5230", { status: 404 });
}
__name(handleAPI, "handleAPI");

// src/admin.js
init_utils();

// src/storage.js
async function uploadFile({ stream, key, contentType }, env) {
  const storageType = env.STORAGE_TYPE || "R2";
  if (storageType === "R2") {
    return uploadToR2({ stream, key, contentType }, env);
  } else if (storageType === "OSS") {
    return uploadToOSS({ stream, key, contentType }, env);
  } else {
    throw new Error(`\u4E0D\u652F\u6301\u7684\u5B58\u50A8\u7C7B\u578B: ${storageType}`);
  }
}
__name(uploadFile, "uploadFile");
async function getFile(key, env) {
  const storageType = env.STORAGE_TYPE || "R2";
  if (storageType === "R2") {
    return getFromR2(key, env);
  } else if (storageType === "OSS") {
    return getFromOSS(key, env);
  } else {
    throw new Error(`\u4E0D\u652F\u6301\u7684\u5B58\u50A8\u7C7B\u578B: ${storageType}`);
  }
}
__name(getFile, "getFile");
async function getFileUrl(key, env, request) {
  const storageType = env.STORAGE_TYPE || "R2";
  if (storageType === "R2") {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}/images/${key}`;
  } else if (storageType === "OSS") {
    const domain = env.OSS_DOMAIN || `${env.OSS_BUCKET}.${env.OSS_REGION}.aliyuncs.com`;
    return `https://${domain}/${key}`;
  } else {
    throw new Error(`\u4E0D\u652F\u6301\u7684\u5B58\u50A8\u7C7B\u578B: ${storageType}`);
  }
}
__name(getFileUrl, "getFileUrl");
async function uploadToR2({ stream, key, contentType }, env) {
  const uploadResult = await env.POST_BUCKET.put(key, stream, {
    httpMetadata: {
      contentType: contentType || "image/jpeg"
    }
  });
  if (!uploadResult) {
    throw new Error("\u4E0A\u4F20\u5230 R2 \u5931\u8D25");
  }
  return key;
}
__name(uploadToR2, "uploadToR2");
async function getFromR2(key, env) {
  return await env.POST_BUCKET.get(key);
}
__name(getFromR2, "getFromR2");
async function uploadToOSS({ stream, key, contentType }, env) {
  const {
    OSS_REGION,
    OSS_BUCKET,
    OSS_ACCESS_KEY_ID,
    OSS_ACCESS_KEY_SECRET
  } = env;
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw new Error("OSS \u914D\u7F6E\u4E0D\u5B8C\u6574");
  }
  const arrayBuffer = await streamToArrayBuffer(stream);
  const host = `${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`;
  const date = (/* @__PURE__ */ new Date()).toUTCString();
  const contentTypeValue = contentType || "image/jpeg";
  const stringToSign = `PUT

${contentTypeValue}
${date}
/${OSS_BUCKET}/${key}`;
  const signature = await generateSignature(stringToSign, OSS_ACCESS_KEY_SECRET);
  const response = await fetch(`https://${host}/${key}`, {
    method: "PUT",
    headers: {
      "Host": host,
      "Date": date,
      "Content-Type": contentTypeValue,
      "Authorization": `OSS ${OSS_ACCESS_KEY_ID}:${signature}`,
      "Content-Length": arrayBuffer.byteLength.toString()
    },
    body: arrayBuffer
  });
  if (!response.ok) {
    throw new Error(`OSS \u4E0A\u4F20\u5931\u8D25: ${response.status} ${response.statusText}`);
  }
  return key;
}
__name(uploadToOSS, "uploadToOSS");
async function getFromOSS(key, env) {
  const domain = env.OSS_DOMAIN || `${env.OSS_BUCKET}.${env.OSS_REGION}.aliyuncs.com`;
  const url = `https://${domain}/${key}`;
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  return {
    body: response.body,
    httpMetadata: {
      contentType: response.headers.get("content-type") || "image/jpeg"
    }
  };
}
__name(getFromOSS, "getFromOSS");
async function streamToArrayBuffer(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }
  const result = new Uint8Array(totalLength);
  let position = 0;
  for (const chunk of chunks) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result.buffer;
}
__name(streamToArrayBuffer, "streamToArrayBuffer");
async function generateSignature(stringToSign, accessKeySecret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(accessKeySecret);
  const messageData = encoder.encode(stringToSign);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
  const signature = Array.from(new Uint8Array(signatureBuffer)).map((b) => String.fromCharCode(b)).join("");
  return btoa(signature);
}
__name(generateSignature, "generateSignature");

// src/session-middleware.js
init_utils();
async function withSession(request, env, handler, requireAuth = true) {
  const url = new URL(request.url);
  const authResult = await verifySession(request, env);
  const isAuthenticated = typeof authResult === "boolean" ? authResult : authResult.valid;
  if (requireAuth && !isAuthenticated && url.pathname !== "/admin/login") {
    const baseUrl = `${url.protocol}//${url.host}`;
    return Response.redirect(`${baseUrl}/admin/login`);
  }
  const headers = {};
  if (isAuthenticated && typeof authResult === "object" && authResult.needsCookieUpdate) {
    const cookieHeader = request.headers.get("Cookie");
    const cookies = cookieHeader ? cookieHeader.split(";").reduce((acc, cookie) => {
      const [key, ...values] = cookie.trim().split("=");
      if (key && values.length > 0) {
        acc[key] = values.join("=");
      }
      return acc;
    }, {}) : {};
    const sessionToken = cookies.session;
    if (sessionToken) {
      headers["Set-Cookie"] = `session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/;`;
    }
  }
  let response = await handler(request, env, authResult);
  if (response instanceof Response) {
    const newHeaders = new Headers(response.headers);
    Object.entries(headers).forEach(([key, value]) => {
      if (!newHeaders.has(key)) {
        newHeaders.set(key, value);
      }
    });
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  }
  return response;
}
__name(withSession, "withSession");
function createHTMLResponse(html, headers = {}) {
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      ...headers
    }
  });
}
__name(createHTMLResponse, "createHTMLResponse");
function createRedirectResponse(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      "Location": location,
      ...headers
    }
  });
}
__name(createRedirectResponse, "createRedirectResponse");

// src/theme.js
function getThemeToggleHTML() {
  return `
    <div class="theme-toggle" id="theme-toggle" title="\u5207\u6362\u6DF1\u8272/\u6D45\u8272\u6A21\u5F0F">
      <svg class="theme-icon sun-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </svg>
      <svg class="theme-icon moon-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
      </svg>
    </div>
  `;
}
__name(getThemeToggleHTML, "getThemeToggleHTML");
function getThemeToggleScript() {
  return `
    <script>
      (function() {
        console.log('Theme script loading...');
        
        // \u7B49\u5F85DOM\u5B8C\u5168\u52A0\u8F7D
        function initThemeToggle() {
          console.log('Initializing theme toggle...');
          
          // \u83B7\u53D6\u4E3B\u9898\u5207\u6362\u6309\u94AE
          const themeToggle = document.getElementById('theme-toggle');
          console.log('Theme toggle element:', themeToggle);
          
          if (!themeToggle) {
            console.log('Theme toggle button not found, retrying in 100ms...');
            setTimeout(initThemeToggle, 100);
            return;
          }
          
          // \u66F4\u65B0\u56FE\u6807\u663E\u793A\u7684\u51FD\u6570
          function updateIcon(theme) {
            console.log('Updating icon for theme:', theme);
            const sunIcon = themeToggle.querySelector('.sun-icon');
            const moonIcon = themeToggle.querySelector('.moon-icon');
            
            if (!sunIcon || !moonIcon) {
              console.log('Icons not found:', { sunIcon, moonIcon });
              return;
            }
            
            if (theme === 'dark') {
              sunIcon.style.display = 'none';
              moonIcon.style.display = 'block';
            } else {
              sunIcon.style.display = 'block';
              moonIcon.style.display = 'none';
            }
          }
          
          // \u83B7\u53D6\u6216\u521D\u59CB\u5316\u4E3B\u9898
          const currentTheme = localStorage.getItem('theme') || 'light';
          console.log('Current theme:', currentTheme);
          document.documentElement.setAttribute('data-theme', currentTheme);
          updateIcon(currentTheme);
          
          // \u6DFB\u52A0\u70B9\u51FB\u4E8B\u4EF6
          themeToggle.addEventListener('click', function(e) {
            console.log('Theme toggle clicked');
            e.preventDefault();
            
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            
            console.log('Switching from', currentTheme, 'to', newTheme);
            
            document.documentElement.setAttribute('data-theme', newTheme);
            localStorage.setItem('theme', newTheme);
            updateIcon(newTheme);
          });
          
          console.log('Theme toggle initialized successfully!');
        }
        
        // \u7ACB\u5373\u521D\u59CB\u5316\uFF0C\u5982\u679CDOM\u8FD8\u6CA1\u51C6\u5907\u597D\u5C31\u7B49\u5F85
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initThemeToggle);
        } else {
          initThemeToggle();
        }
      })();
    <\/script>
  `;
}
__name(getThemeToggleScript, "getThemeToggleScript");
function getThemeCSS() {
  return `
    /* \u4E3B\u9898\u5207\u6362\u6309\u94AE\u6837\u5F0F */
    .theme-toggle {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background-color: #fff;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 1000;
      transition: all 0.3s ease;
    }
    
    .theme-toggle:hover {
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }
    
    .theme-icon {
      width: 24px;
      height: 24px;
      color: #576b95;
      transition: all 0.3s ease;
    }
    
    .moon-icon {
      display: none;
    }
    
    /* \u6DF1\u8272\u6A21\u5F0F\u6837\u5F0F */
    [data-theme="dark"] {
      --bg-primary: #1a1a1a;
      --bg-secondary: #252525;
      --bg-tertiary: #303030;
      --text-primary: #e6e6e6;
      --text-secondary: #b0b0b0;
      --text-tertiary: #888;
      --border-color: #404040;
      --accent-color: #7b8ab8;
      --header-bg: #252525;
      --card-bg: #252525;
      --button-bg: #3a3a3a;
      --code-bg: #1e1e1e;
      --blockquote-bg: #2a2a2a;
      --link-color: #ffffff;
      --link-color-hover: #e0e0e0;
    }
    
    [data-theme="light"] {
      --bg-primary: #ededed;
      --bg-secondary: #ffffff;
      --bg-tertiary: #f7f7f7;
      --text-primary: #333333;
      --text-secondary: #666666;
      --text-tertiary: #999999;
      --border-color: #dcdcdc;
      --accent-color: #576b95;
      --header-bg: #ededed;
      --card-bg: #ffffff;
      --button-bg: #f5f5f5;
      --code-bg: #f1f3f4;
      --blockquote-bg: #f8f9fa;
      --link-color: #576b95;
      --link-color-hover: #4a5d84;
    }
    
    /* \u5E94\u7528\u4E3B\u9898\u53D8\u91CF\u5230\u73B0\u6709\u6837\u5F0F */
    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
    }
    
    .header {
      background-color: var(--header-bg);
      border-bottom-color: var(--border-color);
    }
    
    .header-title {
      color: var(--text-primary);
    }
    
    .post, .compose-box, .login-card, .edit-form {
      background-color: var(--card-bg);
    }
    
    .post-content, .post-date, .username {
      color: var(--text-primary);
    }
    
    .post-date {
      color: var(--text-tertiary);
    }
    
    .post-content code {
      background: var(--code-bg);
    }
    
    .post-content pre {
      background: var(--code-bg);
    }
    
    .post-content blockquote {
      background: var(--blockquote-bg);
      border-left-color: var(--border-color);
    }
    
    .action-btn, .login-btn, .admin-btn, .logout-btn, .home-btn {
      color: var(--accent-color);
    }
    
    .action-btn:hover {
      color: var(--accent-color);
    }
    
    /* \u94FE\u63A5\u6837\u5F0F */
    a {
      color: var(--link-color);
      text-decoration: none;
      transition: color 0.2s ease;
    }
    
    a:hover {
      color: var(--link-color-hover);
      text-decoration: underline;
    }
    
    .post-content a {
      color: var(--link-color);
      text-decoration: underline;
      font-weight: 500;
    }
    
    .post-content a:hover {
      color: var(--link-color-hover);
      text-decoration: underline;
    }
    
    textarea, input[type="text"], input[type="file"] {
      background-color: var(--card-bg);
      border-color: var(--border-color);
      color: var(--text-primary);
    }
    
    .submit-btn {
      background-color: var(--accent-color);
    }
    
    .cancel-btn {
      background-color: var(--button-bg);
      color: var(--text-primary);
    }
    
    .tag {
      background-color: var(--button-bg);
      color: var(--text-secondary);
    }
    
    .divider {
      background-color: var(--bg-primary);
    }
    
    .empty-state {
      background-color: var(--card-bg);
      color: var(--text-secondary);
    }
    
    .features {
      background-color: var(--button-bg);
    }
    
    .security-note {
      background-color: rgba(123, 138, 184, 0.1);
      border-left-color: var(--accent-color);
    }
    
    [data-theme="dark"] .theme-toggle {
      background-color: #2a2a2a;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
    }
    
    [data-theme="dark"] .theme-icon {
      color: #7b8ab8;
    }
  `;
}
__name(getThemeCSS, "getThemeCSS");

// src/admin.js
async function handleAdmin(request, env, dbWrapper3 = null) {
  const url = new URL(request.url);
  const path = url.pathname;
  return withSession(request, env, async (request2, env2, authResult) => {
    if (path === "/admin/logout") {
      return await handleLogout(request2, env2);
    }
    if (path === "/admin/login") {
      return createHTMLResponse(getLoginHTML());
    }
    if (path === "/admin" || path === "/admin/") {
      if (request2.method === "GET") {
        const posts = dbWrapper3 ? await dbWrapper3.getAllPosts() : await getAllPosts(env2.POSTS_KV);
        return createHTMLResponse(getAdminHTML(posts));
      }
      if (request2.method === "POST") {
        return await handleCreatePost(request2, env2);
      }
    }
    if (path.startsWith("/admin/edit/")) {
      const postId = path.split("/").pop();
      if (request2.method === "GET") {
        const postData = dbWrapper3 ? await dbWrapper3.getPost(postId) : await env2.POSTS_KV.get(`post:${postId}`, "json");
        if (!postData) {
          return new Response("\u52A8\u6001\u672A\u627E\u5230", { status: 404 });
        }
        return createHTMLResponse(getEditHTML(postData));
      }
      if (request2.method === "POST") {
        return await handleUpdatePost(request2, env2, postId);
      }
    }
    if (path.startsWith("/admin/delete/")) {
      const postId = path.split("/").pop();
      if (dbWrapper3) {
        await dbWrapper3.deletePost(postId);
      } else {
        await env2.POSTS_KV.delete(`post:${postId}`);
      }
      const baseUrl = `${url.protocol}//${url.host}`;
      return createRedirectResponse(`${baseUrl}/admin`);
    }
    return new Response("\u672A\u627E\u5230", { status: 404 });
  }, false);
}
__name(handleAdmin, "handleAdmin");
async function handleLogout(request, env) {
  const url = new URL(request.url);
  const cookieHeader = request.headers.get("Cookie");
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
      const [key, ...values] = cookie.trim().split("=");
      if (key && values.length > 0) {
        acc[key] = values.join("=");
      }
      return acc;
    }, {});
    const sessionToken = cookies.session;
    if (sessionToken) {
      await env.POSTS_KV.delete(`session:${sessionToken}`);
    }
  }
  const baseUrl = `${url.protocol}//${url.host}`;
  return createRedirectResponse(`${baseUrl}/admin/login`, {
    "Set-Cookie": "session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/"
  });
}
__name(handleLogout, "handleLogout");
async function cleanupOldPosts(kv, maxPosts = 20) {
  try {
    console.log("Checking post count, max allowed:", maxPosts);
    const list = await kv.list({ prefix: "post:" });
    const allPosts = [];
    const promises = list.keys.map(async (key) => {
      const postData = await kv.get(key.name, "json");
      if (postData) {
        allPosts.push({ ...postData, key: key.name });
      }
    });
    await Promise.all(promises);
    allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
    if (allPosts.length > maxPosts) {
      const postsToDelete = allPosts.slice(maxPosts);
      console.log(`Cleaning up ${postsToDelete.length} old posts (keeping ${maxPosts} newest)`);
      const deletePromises = postsToDelete.map((post) => {
        console.log(`Deleting old post: ${post.id} from ${post.date}`);
        return kv.delete(post.key);
      });
      await Promise.all(deletePromises);
      console.log(`Successfully deleted ${postsToDelete.length} old posts`);
    } else {
      console.log(`Post count (${allPosts.length}) within limit (${maxPosts}), no cleanup needed`);
    }
  } catch (error) {
    console.error("Error cleaning up old posts:", error);
  }
}
__name(cleanupOldPosts, "cleanupOldPosts");
async function handleCreatePost(request, env) {
  const formData = await request.formData();
  const content = formData.get("content");
  const tags = formData.get("tags").split(",").map((tag) => tag.trim()).filter(Boolean);
  const image = formData.get("image");
  const postId = Date.now().toString();
  const date = (/* @__PURE__ */ new Date()).toLocaleString("sv-SE").replace("T", " ").slice(0, 19);
  let finalContent = content;
  if (image && image.size > 0) {
    console.log("Processing image:", image.name, "Size:", image.size);
    try {
      const imageKey = `${postId}-${image.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      console.log("Uploading image with key:", imageKey);
      try {
        await uploadFile({
          stream: image.stream(),
          key: imageKey,
          contentType: image.type || "image/jpeg"
        }, env);
        const imageUrl = await getFileUrl(imageKey, env, request);
        finalContent = `![${image.name}](${imageUrl})

${content}`;
        console.log("Image uploaded successfully, URL:", imageUrl);
      } catch (error) {
        console.error("Image upload failed:", error);
      }
    } catch (error) {
      console.error("Image upload failed:", error);
    }
  }
  const postData = {
    id: postId,
    date,
    tags,
    content: finalContent
  };
  if (!dbWrapper) {
    await cleanupOldPosts(env.POSTS_KV, 20);
  }
  if (dbWrapper) {
    await dbWrapper.createPost(postData);
  } else {
    await env.POSTS_KV.put(`post:${postId}`, JSON.stringify(postData));
  }
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return createRedirectResponse(`${baseUrl}/admin`);
}
__name(handleCreatePost, "handleCreatePost");
async function handleUpdatePost(request, env, postId) {
  const formData = await request.formData();
  const content = formData.get("content");
  const tags = formData.get("tags").split(",").map((tag) => tag.trim()).filter(Boolean);
  const image = formData.get("image");
  const existingPost = dbWrapper ? await dbWrapper.getPost(postId) : await env.POSTS_KV.get(`post:${postId}`, "json");
  if (!existingPost) {
    return new Response("\u52A8\u6001\u672A\u627E\u5230", { status: 404 });
  }
  let finalContent = content;
  if (image && image.size > 0) {
    console.log("Processing new image:", image.name, "Size:", image.size);
    try {
      const imageKey = `${postId}-${image.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
      console.log("Uploading image with key:", imageKey);
      try {
        await uploadFile({
          stream: image.stream(),
          key: imageKey,
          contentType: image.type || "image/jpeg"
        }, env);
        const imageUrl = await getFileUrl(imageKey, env, request);
        finalContent = `![${image.name}](${imageUrl})

${content}`;
        console.log("Image uploaded successfully, URL:", imageUrl);
      } catch (error) {
        console.error("Image upload failed:", error);
      }
    } catch (error) {
      console.error("Image upload failed:", error);
    }
  }
  const updatedPost = {
    ...existingPost,
    tags,
    content: finalContent,
    updatedAt: (/* @__PURE__ */ new Date()).toLocaleString("sv-SE").replace("T", " ").slice(0, 19)
  };
  if (dbWrapper) {
    await dbWrapper.updatePost(postId, updatedPost);
  } else {
    await env.POSTS_KV.put(`post:${postId}`, JSON.stringify(updatedPost));
  }
  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return createRedirectResponse(`${baseUrl}/admin`);
}
__name(handleUpdatePost, "handleUpdatePost");
function getLoginHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>\u7BA1\u7406\u5458\u767B\u5F55</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background-color: var(--bg-tertiary);
            color: var(--text-primary);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        .header { 
            height: 46px;
            background-color: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: center;
            align-items: center;
        }
        
        .header-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .back-home {
            position: absolute;
            left: 15px;
            color: var(--accent-color);
            text-decoration: none;
            font-size: 16px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .content {
            flex: 1;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
        }
        
        .login-card {
            background-color: var(--card-bg);
            border-radius: 10px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
            padding: 25px;
            width: 100%;
            max-width: 350px;
        }
        
        .login-header {
            text-align: center;
            margin-bottom: 25px;
        }
        
        .login-avatar {
            width: 60px;
            height: 60px;
            background-image: url('https://imgbed.mcyzsx.top/file/avatar/1765626136745_zsxcoder.jpg');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
            border-radius: 10px;
            margin: 0 auto 15px;
        }
        
        .login-title {
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--text-primary);
        }
        
        .login-subtitle {
            font-size: 14px;
            color: var(--text-tertiary);
            margin-bottom: 20px;
        }
        
        .login-btn {
            width: 100%;
            background-color: #07c160;
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            font-weight: 500;
            padding: 12px;
            cursor: pointer;
            transition: background-color 0.2s;
            text-decoration: none;
            display: inline-block;
            text-align: center;
            margin-bottom: 15px;
        }
        
        .login-btn:hover {
            background-color: #06ad56;
        }
        
        .github-btn {
            background-color: #333;
            margin-bottom: 15px;
        }
        
        .github-btn:hover {
            background-color: #24292e;
        }
        
        .login-divider {
            display: flex;
            align-items: center;
            margin: 15px 0;
            color: #999;
            font-size: 12px;
        }
        
        .login-divider::before, .login-divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background-color: #e5e5e5;
        }
        
        .login-divider-text {
            padding: 0 15px;
        }
        
        .features {
            margin-top: 15px;
            background-color: #f8f8f8;
            border-radius: 5px;
            padding: 15px;
        }
        
        .features-title {
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 10px;
            color: var(--text-primary);
        }
        
        .feature-list {
            display: grid;
            gap: 8px;
        }
        
        .feature-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            color: var(--text-secondary);
        }
        
        .feature-icon {
            width: 16px;
            text-align: center;
        }
        
        .security-note {
            margin-top: 15px;
            padding: 10px;
            background-color: #f0f8ff;
            border-radius: 5px;
            border-left: 3px solid #576b95;
        }
        
        .security-note-title {
            font-size: 13px;
            font-weight: 500;
            color: var(--accent-color);
            margin-bottom: 5px;
            display: flex;
            align-items: center;
            gap: 5px;
        }
        
        .security-note-text {
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.4;
        }
        
        ${getThemeCSS()}
    </style>
</head>
<body>
    <div class="header">
        <a href="/" class="back-home">
            <span>\u2190 \u9996\u9875</span>
        </a>
        <div class="header-title">\u7BA1\u7406\u5458\u767B\u5F55</div>
    </div>
    
    <div class="content">
        <div class="login-card">
            <div class="login-header">
                <div class="login-avatar"></div>
                <div class="login-title">\u7BA1\u7406\u5458\u767B\u5F55</div>
                <div class="login-subtitle">\u4F7F\u7528\u7B2C\u4E09\u65B9\u8D26\u53F7\u5B89\u5168\u767B\u5F55</div>
            </div>
            
            <a href="/auth/login" class="login-btn github-btn">
                <span style="margin-right: 8px;">\u{1F419}</span> \u4F7F\u7528 GitHub \u767B\u5F55
            </a>
            
            <div class="login-divider">
                <div class="login-divider-text">\u6216\u8005</div>
            </div>
            
            <button class="login-btn" disabled>
                \u5FAE\u4FE1\u767B\u5F55 (\u6682\u672A\u5F00\u653E)
            </button>
            
            <div class="features">
                <div class="features-title">\u7BA1\u7406\u529F\u80FD</div>
                <div class="feature-list">
                    <div class="feature-item">
                        <span class="feature-icon">\u{1F4DD}</span>
                        <span>\u53D1\u5E03\u548C\u7F16\u8F91\u52A8\u6001\u5185\u5BB9</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">\u{1F5BC}\uFE0F</span>
                        <span>\u4E0A\u4F20\u548C\u7BA1\u7406\u56FE\u7247</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">\u{1F3F7}\uFE0F</span>
                        <span>\u6DFB\u52A0\u548C\u7BA1\u7406\u6807\u7B7E</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">\u{1F4CA}</span>
                        <span>\u67E5\u770B\u6240\u6709\u5DF2\u53D1\u5E03\u5185\u5BB9</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">\u{1F5D1}\uFE0F</span>
                        <span>\u5220\u9664\u4E0D\u9700\u8981\u7684\u52A8\u6001</span>
                    </div>
                </div>
            </div>
            
            <div class="security-note">
                <div class="security-note-title">
                    <span>\u{1F6E1}\uFE0F</span>
                    <span>\u5B89\u5168\u63D0\u793A</span>
                </div>
                <div class="security-note-text">
                    \u53EA\u6709\u6388\u6743\u7684\u7BA1\u7406\u5458\u8D26\u53F7\u624D\u80FD\u8BBF\u95EE\u540E\u53F0\u7BA1\u7406\u529F\u80FD\uFF0C\u767B\u5F55\u8FC7\u7A0B\u901A\u8FC7 GitHub OAuth \u8FDB\u884C\u5B89\u5168\u9A8C\u8BC1\u3002
                </div>
            </div>
        </div>
    </div>
    
    ${getThemeToggleScript()}
    
    <!-- \u4E3B\u9898\u5207\u6362\u6309\u94AE -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}
__name(getLoginHTML, "getLoginHTML");
function getAdminHTML(posts) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>\u670B\u53CB\u5708\u7BA1\u7406</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-size: 16px;
            line-height: 1.5;
        }
        
        .header { 
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 46px;
            background-color: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .header-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .header-buttons { 
            position: fixed;
            top: 0;
            right: 10px;
            height: 46px;
            display: flex;
            gap: 10px;
            align-items: center;
            z-index: 1001;
        }
        
        .logout-btn, .home-btn { 
            color: var(--accent-color); 
            padding: 6px 12px; 
            text-decoration: none; 
            font-size: 14px;
            transition: opacity 0.2s;
        }
        
        .logout-btn:hover, .home-btn:hover { 
            opacity: 0.8; 
        }
        
        .content {
            padding-top: 56px;
            padding-bottom: 20px;
            background-color: var(--bg-primary);
        }
        
        .admin-container {
            max-width: 620px;
            margin: 0 auto;
            padding: 0 10px;
        }
        
        .compose-box {
            background-color: var(--card-bg);
            margin-bottom: 10px;
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .compose-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            color: var(--text-primary);
            text-align: center;
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 5px;
            color: var(--text-primary);
            font-size: 14px;
        }
        
        textarea, input[type="text"], input[type="file"] {
            width: 100%;
            padding: 10px;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            font-size: 16px;
            font-family: inherit;
            background-color: var(--card-bg);
            color: var(--text-primary);
        }
        
        textarea {
            height: 80px;
            resize: vertical;
            min-height: 80px;
        }
        
        textarea:focus, input:focus {
            outline: none;
            border-color: var(--accent-color);
        }
        
        .submit-btn {
            width: 100%;
            padding: 10px;
            background-color: var(--accent-color);
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .submit-btn:hover {
            opacity: 0.8;
        }
        
        .posts-section {
            margin-top: 10px;
        }
        
        .section-title {
            background-color: var(--header-bg);
            padding: 12px 15px;
            font-size: 16px;
            font-weight: 600;
            color: var(--text-primary);
            border-top: 1px solid var(--border-color);
            border-bottom: 1px solid var(--border-color);
        }
        
        .post-item {
            background-color: var(--card-bg);
            margin-bottom: 10px;
            padding: 15px;
            position: relative;
        }
        
        .post-header {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--border-color);
        }
        
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 5px;
            margin-right: 12px;
            background-image: url('https://imgbed.mcyzsx.top/file/avatar/1765626136745_zsxcoder.jpg');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
        }
        
        .post-info {
            flex: 1;
        }
        
        .post-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .post-date { 
            color: var(--text-tertiary); 
            font-size: 12px; 
        }
        
        .post-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
        }
        
        .tag { 
            background-color: var(--button-bg);
            color: var(--text-secondary);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 12px;
        }
        
        .post-content {
            margin: 10px 0;
            font-size: 16px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .post-content img { 
            max-width: 100%; 
            border-radius: 6px;
            margin: 10px 0;
            display: block;
        }
        
        .post-content h1, .post-content h2, .post-content h3 {
            margin: 10px 0;
            font-size: 16px;
            font-weight: 500;
        }
        
        .post-content p {
            margin: 5px 0;
        }
        
        .post-content code {
            background: var(--code-bg);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 14px;
        }
        
        .post-content pre {
            background: var(--code-bg);
            padding: 10px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 10px 0;
            font-size: 14px;
        }
        
        .post-content blockquote {
            border-left: 3px solid var(--border-color);
            padding-left: 10px;
            margin: 10px 0;
            color: var(--text-secondary);
            font-style: italic;
        }
        
        .post-actions {
            display: flex;
            gap: 10px;
            margin-top: 15px;
            padding-top: 10px;
            border-top: 1px solid var(--border-color);
        }
        
        .action-btn {
            padding: 6px 12px;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            font-size: 14px;
            text-decoration: none;
            color: var(--text-primary);
            display: inline-flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s;
        }
        
        .action-btn:hover {
            background-color: var(--button-bg);
        }
        
        .edit-btn {
            color: var(--accent-color);
            border-color: var(--accent-color);
        }
        
        .edit-btn:hover {
            background-color: rgba(123, 138, 184, 0.1);
        }
        
        .delete-btn {
            color: #ff3b30;
            border-color: #ff3b30;
        }
        
        .delete-btn:hover {
            background-color: rgba(255, 59, 48, 0.1);
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--text-tertiary);
            background-color: var(--card-bg);
        }
        
        .empty-state h3 {
            font-size: 18px;
            margin-bottom: 10px;
            color: var(--text-secondary);
        }
        
        @media (max-width: 620px) {
            .admin-container {
                padding: 0;
            }
            
            .post-item {
                border-radius: 0;
                margin-left: -10px;
                margin-right: -10px;
            }
            
            .compose-box {
                border-radius: 0;
                margin-left: -10px;
                margin-right: -10px;
            }
        }
        
        ${getThemeCSS()}
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">\u670B\u53CB\u5708\u7BA1\u7406</div>
    </div>
    
    <div class="header-buttons">
        <a href="/" class="home-btn">\u9996\u9875</a>
        <a href="/admin/logout" class="logout-btn" onclick="return confirm('\u786E\u5B9A\u8981\u9000\u51FA\u767B\u5F55\u5417\uFF1F')">\u9000\u51FA</a>
    </div>
    
    <div class="content">
        <div class="admin-container">
            <div class="compose-box">
                <h3 class="compose-title">\u53D1\u5E03\u65B0\u52A8\u6001</h3>
                <form method="POST" enctype="multipart/form-data">
                    <div class="form-group">
                        <textarea name="content" placeholder="\u5206\u4EAB\u4F60\u7684\u60F3\u6CD5..." required></textarea>
                    </div>
                    <div class="form-group">
                        <input type="text" name="tags" placeholder="\u6807\u7B7E (\u7528\u9017\u53F7\u5206\u9694\uFF0C\u5982: \u751F\u6D3B, \u5DE5\u4F5C, \u5B66\u4E60)">
                    </div>
                    <div class="form-group">
                        <input type="file" name="image" accept="image/*">
                    </div>
                    <button type="submit" class="submit-btn">\u53D1\u5E03</button>
                </form>
            </div>

            <div class="posts-section">
                <div class="section-title">\u5DF2\u53D1\u5E03\u52A8\u6001</div>
                ${posts.length === 0 ? `
                    <div class="empty-state">
                        <h3>\u8FD8\u6CA1\u6709\u52A8\u6001</h3>
                        <p>\u53D1\u5E03\u4F60\u7684\u7B2C\u4E00\u6761\u52A8\u6001\u5427\uFF01</p>
                    </div>
                ` : posts.map((post) => `
                    <div class="post-item">
                        <div class="post-header">
                            <div class="avatar"></div>
                            <div class="post-info">
                                <div class="post-meta">
                                    <div class="post-date">${post.date}</div>
                                    <div class="post-tags">
                                        ${post.tags.map((tag) => `<span class="tag">#${tag}</span>`).join("")}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="post-content" data-markdown="${encodeURIComponent(post.content)}"></div>
                        <div class="post-actions">
                            <a href="/admin/edit/${post.id}" class="action-btn edit-btn">
                                \u270F\uFE0F \u7F16\u8F91
                            </a>
                            <a href="/admin/delete/${post.id}" class="action-btn delete-btn" onclick="return confirm('\u786E\u5B9A\u5220\u9664\u8FD9\u6761\u52A8\u6001\u5417\uFF1F')">
                                \u{1F5D1}\uFE0F \u5220\u9664
                            </a>
                        </div>
                    </div>
                `).join("")}
            </div>
        </div>
    </div>

    <script>
        // \u6E32\u67D3 Markdown \u5185\u5BB9
        document.querySelectorAll('.post-content').forEach(element => {
            const markdown = decodeURIComponent(element.dataset.markdown);
            element.innerHTML = marked.parse(markdown);
        });
    <\/script>
    
    ${getThemeToggleScript()}
    
    <!-- \u4E3B\u9898\u5207\u6362\u6309\u94AE -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}
__name(getAdminHTML, "getAdminHTML");
function getEditHTML(post) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>\u7F16\u8F91\u52A8\u6001</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-size: 16px;
            line-height: 1.5;
        }
        
        .header { 
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 46px;
            background-color: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .header-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .header-left {
            position: fixed;
            top: 0;
            left: 10px;
            height: 46px;
            display: flex;
            align-items: center;
            z-index: 1001;
        }
        
        .header-right { 
            position: fixed;
            top: 0;
            right: 10px;
            height: 46px;
            display: flex;
            gap: 10px;
            align-items: center;
            z-index: 1001;
        }
        
        .back-link, .logout-btn, .home-btn { 
            color: var(--accent-color); 
            padding: 6px 12px; 
            text-decoration: none; 
            font-size: 14px;
            transition: opacity 0.2s;
        }
        
        .back-link:hover, .logout-btn:hover, .home-btn:hover { 
            opacity: 0.8; 
        }
        
        .content {
            padding-top: 56px;
            padding-bottom: 20px;
            background-color: var(--bg-primary);
        }
        
        .edit-container {
            max-width: 620px;
            margin: 0 auto;
            padding: 0 10px;
        }
        
        .edit-form {
            background-color: var(--card-bg);
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .form-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            color: var(--text-primary);
            text-align: center;
        }
        
        .post-info {
            background-color: var(--button-bg);
            padding: 12px;
            border-radius: 5px;
            margin-bottom: 15px;
            font-size: 14px;
            color: var(--text-secondary);
        }
        
        .form-group {
            margin-bottom: 15px;
        }
        
        .form-group label {
            display: block;
            margin-bottom: 5px;
            color: var(--text-primary);
            font-size: 14px;
        }
        
        textarea, input[type="text"], input[type="file"] {
            width: 100%;
            padding: 10px;
            border: 1px solid var(--border-color);
            border-radius: 5px;
            font-size: 16px;
            font-family: inherit;
            background-color: var(--card-bg);
            color: var(--text-primary);
        }
        
        textarea {
            height: 120px;
            resize: vertical;
            min-height: 100px;
        }
        
        textarea:focus, input:focus {
            outline: none;
            border-color: var(--accent-color);
        }
        
        .form-help {
            font-size: 12px;
            color: var(--text-tertiary);
            margin-top: 5px;
        }
        
        .form-actions {
            display: flex;
            gap: 10px;
            margin-top: 20px;
        }
        
        .submit-btn {
            flex: 1;
            padding: 10px;
            background-color: var(--accent-color);
            color: white;
            border: none;
            border-radius: 5px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        .submit-btn:hover {
            opacity: 0.8;
        }
        
        .cancel-btn {
            flex: 1;
            padding: 10px;
            background-color: var(--button-bg);
            color: var(--text-primary);
            border: none;
            border-radius: 5px;
            font-size: 16px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s;
            text-decoration: none;
            text-align: center;
        }
        
        .cancel-btn:hover {
            opacity: 0.8;
        }
        
        @media (max-width: 620px) {
            .edit-container {
                padding: 0;
            }
            
            .edit-form {
                border-radius: 0;
                margin-left: -10px;
                margin-right: -10px;
            }
        }
        
        ${getThemeCSS()}
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">\u7F16\u8F91\u52A8\u6001</div>
    </div>
    
    <div class="header-left">
        <a href="/admin" class="back-link">\u8FD4\u56DE</a>
    </div>
    
    <div class="header-right">
        <a href="/" class="home-btn">\u9996\u9875</a>
        <a href="/admin/logout" class="logout-btn" onclick="return confirm('\u786E\u5B9A\u8981\u9000\u51FA\u767B\u5F55\u5417\uFF1F')">\u9000\u51FA</a>
    </div>
    
    <div class="content">
        <div class="edit-container">
            <div class="edit-form">
                <h3 class="form-title">\u7F16\u8F91\u52A8\u6001</h3>
                
                <div class="post-info">
                    <div>\u521B\u5EFA\u65F6\u95F4: ${post.date}</div>
                    <div>\u52A8\u6001 ID: ${post.id}</div>
                    ${post.updatedAt ? `<div>\u6700\u540E\u66F4\u65B0: ${post.updatedAt}</div>` : ""}
                </div>
                
                <form method="POST" enctype="multipart/form-data">
                    <div class="form-group">
                        <textarea name="content" required>${post.content}</textarea>
                    </div>
                    
                    <div class="form-group">
                        <input type="text" name="tags" value="${post.tags.join(", ")}" placeholder="\u6807\u7B7E (\u7528\u9017\u53F7\u5206\u9694)">
                    </div>
                    
                    <div class="form-group">
                        <input type="file" name="image" accept="image/*">
                        <div class="form-help">\u5982\u679C\u4E0D\u9009\u62E9\u65B0\u56FE\u7247\uFF0C\u5C06\u4FDD\u6301\u539F\u6709\u56FE\u7247</div>
                    </div>
                    
                    <div class="form-actions">
                        <button type="submit" class="submit-btn">\u4FDD\u5B58</button>
                        <a href="/admin" class="cancel-btn">\u53D6\u6D88</a>
                    </div>
                </form>
            </div>
        </div>
    </div>
    
    ${getThemeToggleScript()}
    
    <!-- \u4E3B\u9898\u5207\u6362\u6309\u94AE -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}
__name(getEditHTML, "getEditHTML");

// src/public.js
init_utils();
async function handlePublic(request, env, dbWrapper3 = null) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/images/")) {
    const imageKey = url.pathname.replace("/images/", "");
    const storageType = env.STORAGE_TYPE || "R2";
    if (storageType === "OSS") {
      const ossUrl = await getFileUrl(imageKey, env, request);
      return Response.redirect(ossUrl);
    }
    const object = await getFile(imageKey, env);
    if (!object) {
      return new Response("\u56FE\u7247\u672A\u627E\u5230", { status: 404 });
    }
    return new Response(object.body, {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "image/jpeg",
        "Cache-Control": "public, max-age=31536000"
      }
    });
  }
  const posts = dbWrapper3 ? await dbWrapper3.getAllPosts() : await getAllPosts(env.POSTS_KV);
  return new Response(getPublicHTML(posts), {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
__name(handlePublic, "handlePublic");
function getPublicHTML(posts) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>\u670B\u53CB\u5708</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"><\/script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            font-size: 16px;
            line-height: 1.5;
        }
        
        .header { 
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 46px;
            background-color: var(--header-bg);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        
        .header-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--text-primary);
        }
        
        .header-buttons { 
            position: fixed;
            top: 0;
            right: 10px;
            height: 46px;
            display: flex;
            gap: 10px;
            align-items: center;
            z-index: 1001;
        }
        
        .login-btn, .admin-btn { 
            color: #576b95; 
            padding: 6px 12px; 
            text-decoration: none; 
            font-size: 14px;
            transition: opacity 0.2s;
        }
        
        .login-btn:hover, .admin-btn:hover { 
            opacity: 0.8; 
        }
        
        .content {
            padding-top: 56px;
            padding-bottom: 20px;
            background-color: var(--bg-primary);
        }
        
        .moments-container {
            max-width: 620px;
            margin: 0 auto;
        }
        
        .post { 
            background-color: var(--card-bg);
            margin-bottom: 10px;
            padding: 16px;
            position: relative;
        }
        
        .post-header {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        }
        
        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 5px;
            margin-right: 12px;
            background-image: url('https://imgbed.mcyzsx.top/file/avatar/1765626136745_zsxcoder.jpg');
            background-size: cover;
            background-position: center;
            background-repeat: no-repeat;
        }
        
        .user-info {
            flex: 1;
        }
        
        .username {
            color: var(--accent-color);
            font-size: 16px;
            font-weight: 500;
        }
        
        .post-date { 
            color: var(--text-tertiary); 
            font-size: 12px; 
            margin-top: 2px;
        }
        
        .more-options {
            width: 20px;
            height: 20px;
            background-size: contain;
            background-repeat: no-repeat;
            opacity: 0.6;
            cursor: pointer;
        }
        
        .post-content { 
            margin: 10px 0;
            font-size: 16px;
            line-height: 1.6;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .post-content img { 
            max-width: 100%; 
            border-radius: 6px;
            margin: 10px 0;
            display: block;
        }
        
        .post-content h1, .post-content h2, .post-content h3 {
            margin: 10px 0;
            font-size: 16px;
            font-weight: 500;
            color: #333;
        }
        
        .post-content p {
            margin: 5px 0;
        }
        
        .post-content code {
            background: var(--code-bg);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: 'Monaco', 'Consolas', monospace;
            font-size: 14px;
        }
        
        .post-content pre {
            background: var(--code-bg);
            padding: 10px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 10px 0;
            font-size: 14px;
        }
        
        .post-content blockquote {
            border-left: 3px solid var(--border-color);
            padding-left: 10px;
            margin: 10px 0;
            color: var(--text-secondary);
            font-style: italic;
        }
        
        .post-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-top: 8px;
        }
        
        .tag { 
            background-color: var(--button-bg);
            color: var(--text-secondary);
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 12px;
            display: inline-block;
        }
        
        .post-footer {
            display: none;
            margin-top: 10px;
            border-top: 1px solid var(--border-color);
            padding-top: 10px;
        }
        
        .divider {
            height: 10px;
            background-color: var(--bg-primary);
        }
        
        @media (max-width: 620px) {
            .moments-container {
                max-width: 100%;
            }
            
            .post {
                border-radius: 0;
                margin-left: 0;
                margin-right: 0;
            }
        }
        
        ${getThemeCSS()}
    </style>
</head>
<body>
    <div class="header">
        <div class="header-title">\u670B\u53CB\u5708</div>
    </div>
    
    <div class="header-buttons">
        <a href="/admin" class="admin-btn">\u7BA1\u7406</a>
        <a href="/admin/login" class="login-btn">\u767B\u5F55</a>
    </div>
    
    <div class="content">
        <div class="moments-container">
            ${posts.map((post, index) => `
                ${index > 0 ? '<div class="divider"></div>' : ""}
                <div class="post">
                    <div class="post-header">
                        <div class="avatar"></div>
                        <div class="user-info">
                            <div class="username">\u949F\u795E\u79C0</div>
                            <div class="post-date">${post.date}</div>
                        </div>
                        <div class="more-options"></div>
                    </div>
                    <div class="post-content" data-markdown="${encodeURIComponent(post.content)}"></div>
                    <div class="post-tags">
                        ${post.tags.map((tag) => `<span class="tag">#${tag}</span>`).join("")}
                    </div>
                    <div class="post-footer">
                        <!-- \u79FB\u9664\u4E86\u8D5E\u3001\u8BC4\u8BBA\u3001\u5206\u4EAB\u6309\u94AE -->
                    </div>
                </div>
            `).join("")}
        </div>
    </div>

    <script>
        // \u6E32\u67D3 Markdown \u5185\u5BB9
        document.querySelectorAll('.post-content').forEach(element => {
            const markdown = decodeURIComponent(element.dataset.markdown);
            element.innerHTML = marked.parse(markdown);
        });
        
        // \u521D\u59CB\u5316 more-options \u56FE\u6807\u989C\u8272
        function updateMoreOptionsIcon() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const color = isDark ? '%23b0b0b0' : '%23999';
            const svgUrl = 'url(data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="' + color + '"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>');
            document.querySelectorAll('.more-options').forEach(el => {
                el.style.backgroundImage = svgUrl;
            });
        }
        
        // \u76D1\u542C\u4E3B\u9898\u5207\u6362\u4E8B\u4EF6
        const observer = new MutationObserver(updateMoreOptionsIcon);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        
        // \u521D\u59CB\u8BBE\u7F6E\u56FE\u6807
        updateMoreOptionsIcon();
    <\/script>
    
    ${getThemeToggleScript()}
    
    <!-- \u4E3B\u9898\u5207\u6362\u6309\u94AE -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}
__name(getPublicHTML, "getPublicHTML");

// src/database.js
var NeonDatabase = class {
  static {
    __name(this, "NeonDatabase");
  }
  constructor(env) {
    this.env = env;
    this.connectionString = env.DATABASE_URL;
    this.pool = null;
  }
  async initialize() {
    try {
      console.log("Initializing Neon PostgreSQL connection...");
      const { Pool } = await import("pg");
      this.pool = new Pool({
        connectionString: this.connectionString,
        ssl: { rejectUnauthorized: false },
        max: 20,
        // 连接池大小
        idleTimeoutMillis: 3e4,
        connectionTimeoutMillis: 1e4
      });
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
      console.log("Neon PostgreSQL initialized successfully");
      await this.initializeTables();
    } catch (error) {
      console.error("Failed to initialize Neon database:", error);
      throw error;
    }
  }
  async initializeTables() {
    const client = await this.pool.connect();
    try {
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
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (date DESC)
      `);
      console.log("Database tables initialized");
    } catch (error) {
      console.error("Error initializing tables:", error);
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
      return result.rows.map((row) => ({
        ...row,
        tags: row.tags || []
      }));
    } catch (error) {
      console.error("Error getting all posts:", error);
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
      console.error("Error getting post:", error);
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
      `, [postData.id, postData.title || "", postData.content, postData.tags || [], postData.date]);
      console.log("Created post:", result.rows[0].id);
      return result.rows[0];
    } catch (error) {
      console.error("Error creating post:", error);
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
      `, [updateData.title || "", updateData.content, updateData.tags || [], postId]);
      if (result.rows.length === 0) return null;
      console.log("Updated post:", postId);
      return {
        ...result.rows[0],
        tags: result.rows[0].tags || []
      };
    } catch (error) {
      console.error("Error updating post:", error);
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
      console.log(`${deleted ? "Deleted" : "Not found"} post: ${postId}`);
      return deleted;
    } catch (error) {
      console.error("Error deleting post:", error);
      throw error;
    } finally {
      client.release();
    }
  }
  // 会话相关操作
  async createSession(token, username, expiresIn = 604800) {
    const client = await this.pool.connect();
    try {
      const expiresAt = new Date(Date.now() + expiresIn * 1e3);
      await client.query(`
        INSERT INTO sessions (token, username, expires_at)
        VALUES ($1, $2, $3)
      `, [token, username, expiresAt]);
      console.log("Created session for user:", username);
      return true;
    } catch (error) {
      console.error("Error creating session:", error);
      return false;
    } finally {
      client.release();
    }
  }
  async getSession(token) {
    const client = await this.pool.connect();
    try {
      await this.cleanupExpiredSessions(client);
      const result = await client.query(`
        SELECT token, username, created_at, last_accessed, expires_at
        FROM sessions 
        WHERE token = $1 AND expires_at > NOW()
      `, [token]);
      if (result.rows.length === 0) return null;
      const session = result.rows[0];
      client.query(`
        UPDATE sessions 
        SET last_accessed = NOW() 
        WHERE token = $1
      `, [token]).catch((err) => console.error("Error updating last accessed:", err));
      return {
        username: session.username,
        createdAt: session.created_at,
        lastAccessed: session.last_accessed
      };
    } catch (error) {
      console.error("Error getting session:", error);
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
      console.error("Error updating session:", error);
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
      console.log(`${deleted ? "Deleted" : "Not found"} session: ${token.substring(0, 8)}...`);
      return deleted;
    } catch (error) {
      console.error("Error deleting session:", error);
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
      console.error("Error cleaning up sessions:", error);
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
      console.error("Error getting stats:", error);
      return null;
    } finally {
      client.release();
    }
  }
  // 关闭连接池
  async close() {
    if (this.pool) {
      await this.pool.end();
      console.log("Neon PostgreSQL connection closed");
    }
  }
  // 健康检查
  async healthCheck() {
    try {
      const client = await this.pool.connect();
      const result = await client.query("SELECT 1 as health");
      client.release();
      return {
        status: "healthy",
        database: "neon_postgresql",
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        connected: this.pool.totalCount || 0
      };
    } catch (error) {
      return {
        status: "unhealthy",
        error: error.message,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
  }
};
function createDatabaseAdapter(env) {
  const dbType = env.DATABASE_TYPE || "kv";
  switch (dbType.toLowerCase()) {
    case "neon":
    case "postgresql":
      console.log("Using Neon PostgreSQL adapter");
      return new NeonDatabase(env);
    case "kv":
    default:
      console.log("Using KV fallback adapter");
      return null;
  }
}
__name(createDatabaseAdapter, "createDatabaseAdapter");
var DatabaseWrapper = class {
  static {
    __name(this, "DatabaseWrapper");
  }
  constructor(env) {
    this.adapter = createDatabaseAdapter(env);
    this.env = env;
  }
  async initialize() {
    if (this.adapter) {
      await this.adapter.initialize();
    }
  }
  // 自动路由到合适的数据库
  async getAllPosts() {
    if (this.adapter) {
      return await this.adapter.getAllPosts();
    }
    const { getAllPosts: getAllPosts2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
    return await getAllPosts2(this.env.POSTS_KV);
  }
  async getPost(postId) {
    if (this.adapter) {
      return await this.adapter.getPost(postId);
    }
    const postData = await this.env.POSTS_KV.get(`post:${postId}`, "json");
    return postData;
  }
  async createPost(postData) {
    if (this.adapter) {
      return await this.adapter.createPost(postData);
    }
    await this.env.POSTS_KV.put(`post:${postData.id}`, JSON.stringify(postData));
    return postData;
  }
  async updatePost(postId, updateData) {
    if (this.adapter) {
      return await this.adapter.updatePost(postId, updateData);
    }
    const existingPost = await this.env.POSTS_KV.get(`post:${postId}`, "json");
    if (!existingPost) return null;
    const updatedPost = { ...existingPost, ...updateData, updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
    await this.env.POSTS_KV.put(`post:${postId}`, JSON.stringify(updatedPost));
    return updatedPost;
  }
  async deletePost(postId) {
    if (this.adapter) {
      return await this.adapter.deletePost(postId);
    }
    await this.env.POSTS_KV.delete(`post:${postId}`);
    return true;
  }
  async getSession(token) {
    if (this.adapter) {
      return await this.adapter.getSession(token);
    }
    const { verifySession: verifySession2 } = await Promise.resolve().then(() => (init_utils(), utils_exports));
    const result = await verifySession2(
      { headers: { get: /* @__PURE__ */ __name(() => `session=${token}`, "get") } },
      this.env
    );
    return result.valid ? { username: result.username } : null;
  }
  async getStats() {
    if (this.adapter) {
      return await this.adapter.getStats();
    }
    try {
      const list = await this.env.POSTS_KV.list({ prefix: "post:" });
      const sessionList = await this.env.POSTS_KV.list({ prefix: "session:" });
      return {
        posts: { total: list.keys.length },
        sessions: {
          active: sessionList.keys.length,
          expired: "unknown"
        },
        database: { type: "cloudflare_kv" }
      };
    } catch (error) {
      console.error("Error getting KV stats:", error);
      return null;
    }
  }
};

// src/index.js
var dbWrapper2 = null;
async function initializeDatabase(env) {
  if (!dbWrapper2) {
    dbWrapper2 = new DatabaseWrapper(env);
    await dbWrapper2.initialize();
  }
}
__name(initializeDatabase, "initializeDatabase");
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      await initializeDatabase(env);
      if (path.startsWith("/auth")) {
        return handleAuth(request, env, dbWrapper2);
      }
      if (path.startsWith("/api")) {
        return handleAPI(request, env, dbWrapper2);
      }
      if (path.startsWith("/admin")) {
        return handleAdmin(request, env, dbWrapper2);
      }
      return handlePublic(request, env, dbWrapper2);
    } catch (error) {
      console.error("Error handling request:", error);
      return new Response(`\u670D\u52A1\u5668\u9519\u8BEF: ${error.message}`, {
        status: 500,
        headers: corsHeaders
      });
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
