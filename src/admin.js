import { getAllPosts, clearPostsCache } from './utils.js';
import { uploadFile, getFileUrl } from './storage.js';
import { withSession, createHTMLResponse, createRedirectResponse } from './session-middleware.js';
import { getThemeToggleHTML, getThemeToggleScript, getThemeCSS } from './theme.js';

export async function handleAdmin(request, env, dbWrapper = null) {
  const url = new URL(request.url);
  const path = url.pathname;

  // 使用会话中间件处理所有请求
  return withSession(request, env, async (request, env, authResult) => {
    // 处理退出登录
    if (path === '/admin/logout') {
      return await handleLogout(request, env);
    }
    
    // 处理登录页面
    if (path === '/admin/login') {
      return createHTMLResponse(getLoginHTML());
    }

    // 处理管理后台主页
    if (path === '/admin' || path === '/admin/') {
      if (request.method === 'GET') {
        const posts = dbWrapper ? await dbWrapper.getAllPosts() : await getAllPosts(env.POSTS_KV);
        return createHTMLResponse(getAdminHTML(posts));
      }

      if (request.method === 'POST') {
        return await handleCreatePost(request, env, dbWrapper);
      }
    }

    // 处理编辑页面
    if (path.startsWith('/admin/edit/')) {
      const postId = path.split('/').pop();
      
      if (request.method === 'GET') {
        const postData = dbWrapper ? await dbWrapper.getPost(postId) : await env.POSTS_KV.get(`post:${postId}`, 'json');
        if (!postData) {
          return new Response('动态未找到', { status: 404 });
        }
        return createHTMLResponse(getEditHTML(postData));
      }
      
      if (request.method === 'POST') {
        return await handleUpdatePost(request, env, postId, dbWrapper);
      }
    }

    // 处理删除请求
    if (path.startsWith('/admin/delete/')) {
      const postId = path.split('/').pop();

      if (dbWrapper) {
        await dbWrapper.deletePost(postId);
      } else {
        await env.POSTS_KV.delete(`post:${postId}`);
      }

      // 清除缓存，确保删除立即可见
      clearPostsCache();

      const baseUrl = `${url.protocol}//${url.host}`;
      return createRedirectResponse(`${baseUrl}/admin`);
    }

    return new Response('未找到', { status: 404 });
  }, false); // 退出登录和登录页面不需要强制认证
}

async function handleLogout(request, env) {
  const url = new URL(request.url);
  const cookieHeader = request.headers.get('Cookie');
  
  if (cookieHeader) {
    const cookies = cookieHeader.split(';').reduce((acc, cookie) => {
      const [key, ...values] = cookie.trim().split('=');
      if (key && values.length > 0) {
        acc[key] = values.join('=');
      }
      return acc;
    }, {});
    
    const sessionToken = cookies.session;
    if (sessionToken) {
      // 从 KV 中删除会话信息
      await env.POSTS_KV.delete(`session:${sessionToken}`);
    }
  }
  
  const baseUrl = `${url.protocol}//${url.host}`;
  return createRedirectResponse(`${baseUrl}/admin/login`, {
    'Set-Cookie': 'session=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'
  });
}

// 自动清理旧文章，只保留最新的指定数量
async function cleanupOldPosts(kv, maxPosts = 20) {
  try {
    console.log('Checking post count, max allowed:', maxPosts);
    
    // 获取所有文章键
    const list = await kv.list({ prefix: 'post:' });
    const allPosts = [];
    
    // 并行获取所有文章数据
    const promises = list.keys.map(async key => {
      const postData = await kv.get(key.name, 'json');
      if (postData) {
        allPosts.push({ ...postData, key: key.name });
      }
    });
    
    await Promise.all(promises);
    
    // 按时间排序（最新的在前）
    allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    // 检查是否需要清理
    if (allPosts.length > maxPosts) {
      const postsToDelete = allPosts.slice(maxPosts);
      console.log(`Cleaning up ${postsToDelete.length} old posts (keeping ${maxPosts} newest)`);
      
      // 批量删除旧文章
      const deletePromises = postsToDelete.map(post => {
        console.log(`Deleting old post: ${post.id} from ${post.date}`);
        return kv.delete(post.key);
      });
      
      await Promise.all(deletePromises);
      console.log(`Successfully deleted ${postsToDelete.length} old posts`);
    } else {
      console.log(`Post count (${allPosts.length}) within limit (${maxPosts}), no cleanup needed`);
    }
  } catch (error) {
    console.error('Error cleaning up old posts:', error);
    // 不影响文章创建，只是记录错误
  }
}

async function handleCreatePost(request, env, dbWrapper = null) {
  const formData = await request.formData();
  const content = formData.get('content');
  const tags = formData.get('tags').split(',').map(tag => tag.trim()).filter(Boolean);
  const image = formData.get('image');

  const postId = Date.now().toString();
  const date = new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19);

  let finalContent = content;

  // 处理图片上传
  if (image && image.size > 0) {
    console.log('Processing image:', image.name, 'Size:', image.size);
    
    try {
      // 生成安全的文件名
      const imageKey = `${postId}-${image.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      console.log('Uploading image with key:', imageKey);
      
      // 上传到存储服务（R2 或 OSS）
      try {
        await uploadFile({
          stream: image.stream(),
          key: imageKey,
          contentType: image.type || 'image/jpeg'
        }, env);
        
        const imageUrl = await getFileUrl(imageKey, env, request);
        finalContent = `![${image.name}](${imageUrl})\n\n${content}`;
        console.log('Image uploaded successfully, URL:', imageUrl);
      } catch (error) {
        console.error('Image upload failed:', error);
        // 继续发布文本内容，即使图片上传失败
      }
    } catch (error) {
      console.error('Image upload failed:', error);
      // 继续发布文本内容，即使图片上传失败
    }
  }

  const postData = {
    id: postId,
    date: date,
    tags: tags,
    content: finalContent
  };

  // 如果使用 KV，自动清理旧文章（只保留最新的20篇）
  if (!dbWrapper) {
    await cleanupOldPosts(env.POSTS_KV, 20);
  }

  if (dbWrapper) {
    await dbWrapper.createPost(postData);
  } else {
    await env.POSTS_KV.put(`post:${postId}`, JSON.stringify(postData));
  }

  // 清除缓存，确保新文章立即可见
  clearPostsCache();

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return createRedirectResponse(`${baseUrl}/admin`);
}

async function handleUpdatePost(request, env, postId, dbWrapper = null) {
  const formData = await request.formData();
  const content = formData.get('content');
  const tags = formData.get('tags').split(',').map(tag => tag.trim()).filter(Boolean);
  const image = formData.get('image');

  // 获取原有数据
  const existingPost = dbWrapper ? await dbWrapper.getPost(postId) : await env.POSTS_KV.get(`post:${postId}`, 'json');
  if (!existingPost) {
    return new Response('动态未找到', { status: 404 });
  }

  let finalContent = content;

  // 处理新图片上传
  if (image && image.size > 0) {
    console.log('Processing new image:', image.name, 'Size:', image.size);
    
    try {
      const imageKey = `${postId}-${image.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      console.log('Uploading image with key:', imageKey);
      
      // 上传到存储服务（R2 或 OSS）
      try {
        await uploadFile({
          stream: image.stream(),
          key: imageKey,
          contentType: image.type || 'image/jpeg'
        }, env);
        
        const imageUrl = await getFileUrl(imageKey, env, request);
        finalContent = `![${image.name}](${imageUrl})\n\n${content}`;
        console.log('Image uploaded successfully, URL:', imageUrl);
      } catch (error) {
        console.error('Image upload failed:', error);
      }
    } catch (error) {
      console.error('Image upload failed:', error);
    }
  }

  const updatedPost = {
    ...existingPost,
    tags: tags,
    content: finalContent,
    updatedAt: new Date().toLocaleString('sv-SE').replace('T', ' ').slice(0, 19)
  };

  if (dbWrapper) {
    await dbWrapper.updatePost(postId, updatedPost);
  } else {
    await env.POSTS_KV.put(`post:${postId}`, JSON.stringify(updatedPost));
  }

  // 清除缓存，确保更新立即可见
  clearPostsCache();

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  return createRedirectResponse(`${baseUrl}/admin`);
}

function getLoginHTML() {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>管理员登录</title>
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
            background-color: #ffffff;
            color: #333;
            margin-bottom: 15px;
            border: 1px solid #e5e5e5;
        }

        .github-btn:hover {
            background-color: #f5f5f5;
            border-color: #d0d0d0;
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
            <span>← 首页</span>
        </a>
        <div class="header-title">管理员登录</div>
    </div>
    
    <div class="content">
        <div class="login-card">
            <div class="login-header">
                <div class="login-avatar"></div>
                <div class="login-title">管理员登录</div>
                <div class="login-subtitle">使用第三方账号安全登录</div>
            </div>
            
            <a href="/auth/login" class="login-btn github-btn">
                <span style="margin-right: 8px;">🐙</span> 使用 GitHub 登录
            </a>
            
            <div class="login-divider">
                <div class="login-divider-text">或者</div>
            </div>
            
            <button class="login-btn" disabled>
                微信登录 (暂未开放)
            </button>
            
            <div class="features">
                <div class="features-title">管理功能</div>
                <div class="feature-list">
                    <div class="feature-item">
                        <span class="feature-icon">📝</span>
                        <span>发布和编辑动态内容</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">🖼️</span>
                        <span>上传和管理图片</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">🏷️</span>
                        <span>添加和管理标签</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">📊</span>
                        <span>查看所有已发布内容</span>
                    </div>
                    <div class="feature-item">
                        <span class="feature-icon">🗑️</span>
                        <span>删除不需要的动态</span>
                    </div>
                </div>
            </div>
            
            <div class="security-note">
                <div class="security-note-title">
                    <span>🛡️</span>
                    <span>安全提示</span>
                </div>
                <div class="security-note-text">
                    只有授权的管理员账号才能访问后台管理功能，登录过程通过 GitHub OAuth 进行安全验证。
                </div>
            </div>
        </div>
    </div>
    
    ${getThemeToggleScript()}
    
    <!-- 主题切换按钮 -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}

function getAdminHTML(posts) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>朋友圈管理</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
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
        <div class="header-title">朋友圈管理</div>
    </div>
    
    <div class="header-buttons">
        <a href="/" class="home-btn">首页</a>
        <a href="/admin/logout" class="logout-btn" onclick="return confirm('确定要退出登录吗？')">退出</a>
    </div>
    
    <div class="content">
        <div class="admin-container">
            <div class="compose-box">
                <h3 class="compose-title">发布新动态</h3>
                <form method="POST" enctype="multipart/form-data">
                    <div class="form-group">
                        <textarea name="content" placeholder="分享你的想法..." required></textarea>
                    </div>
                    <div class="form-group">
                        <input type="text" name="tags" placeholder="标签 (用逗号分隔，如: 生活, 工作, 学习)">
                    </div>
                    <div class="form-group">
                        <input type="file" name="image" accept="image/*">
                    </div>
                    <button type="submit" class="submit-btn">发布</button>
                </form>
            </div>

            <div class="posts-section">
                <div class="section-title">已发布动态</div>
                ${posts.length === 0 ? `
                    <div class="empty-state">
                        <h3>还没有动态</h3>
                        <p>发布你的第一条动态吧！</p>
                    </div>
                ` : posts.map(post => `
                    <div class="post-item">
                        <div class="post-header">
                            <div class="avatar"></div>
                            <div class="post-info">
                                <div class="post-meta">
                                    <div class="post-date">${post.date}</div>
                                    <div class="post-tags">
                                        ${post.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="post-content" data-markdown="${encodeURIComponent(post.content)}"></div>
                        <div class="post-actions">
                            <a href="/admin/edit/${post.id}" class="action-btn edit-btn">
                                ✏️ 编辑
                            </a>
                            <a href="/admin/delete/${post.id}" class="action-btn delete-btn" onclick="return confirm('确定删除这条动态吗？')">
                                🗑️ 删除
                            </a>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    </div>

    <script>
        // 渲染 Markdown 内容
        document.querySelectorAll('.post-content').forEach(element => {
            const markdown = decodeURIComponent(element.dataset.markdown);
            element.innerHTML = marked.parse(markdown);
        });
    </script>
    
    ${getThemeToggleScript()}
    
    <!-- 主题切换按钮 -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}

function getEditHTML(post) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>编辑动态</title>
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
        <div class="header-title">编辑动态</div>
    </div>
    
    <div class="header-left">
        <a href="/admin" class="back-link">返回</a>
    </div>
    
    <div class="header-right">
        <a href="/" class="home-btn">首页</a>
        <a href="/admin/logout" class="logout-btn" onclick="return confirm('确定要退出登录吗？')">退出</a>
    </div>
    
    <div class="content">
        <div class="edit-container">
            <div class="edit-form">
                <h3 class="form-title">编辑动态</h3>
                
                <div class="post-info">
                    <div>创建时间: ${post.date}</div>
                    <div>动态 ID: ${post.id}</div>
                    ${post.updatedAt ? `<div>最后更新: ${post.updatedAt}</div>` : ''}
                </div>
                
                <form method="POST" enctype="multipart/form-data">
                    <div class="form-group">
                        <textarea name="content" required>${post.content}</textarea>
                    </div>
                    
                    <div class="form-group">
                        <input type="text" name="tags" value="${post.tags.join(', ')}" placeholder="标签 (用逗号分隔)">
                    </div>
                    
                    <div class="form-group">
                        <input type="file" name="image" accept="image/*">
                        <div class="form-help">如果不选择新图片，将保持原有图片</div>
                    </div>
                    
                    <div class="form-actions">
                        <button type="submit" class="submit-btn">保存</button>
                        <a href="/admin" class="cancel-btn">取消</a>
                    </div>
                </form>
            </div>
        </div>
    </div>
    
    ${getThemeToggleScript()}
    
    <!-- 主题切换按钮 -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}