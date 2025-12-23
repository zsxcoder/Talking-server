import { getAllPosts } from './utils.js';
import { getFile, getFileUrl } from './storage.js';
import { getThemeToggleHTML, getThemeToggleScript, getThemeCSS } from './theme.js';

export async function handlePublic(request, env) {
  const url = new URL(request.url);
  
  if (url.pathname.startsWith('/images/')) {
    const imageKey = url.pathname.replace('/images/', '');
    const storageType = env.STORAGE_TYPE || 'R2';
    
    // 如果使用 OSS，直接重定向到 OSS 上的资源
    if (storageType === 'OSS') {
      const ossUrl = await getFileUrl(imageKey, env, request);
      return Response.redirect(ossUrl);
    }
    
    // 对于 R2，直接提供文件内容
    const object = await getFile(imageKey, env);
    
    if (!object) {
      return new Response('图片未找到', { status: 404 });
    }

    return new Response(object.body, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'public, max-age=31536000',
      },
    });
  }

  // 主页展示
  const posts = await getAllPosts(env.POSTS_KV);
  return new Response(getPublicHTML(posts), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function getPublicHTML(posts) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>朋友圈</title>
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
        <div class="header-title">朋友圈</div>
    </div>
    
    <div class="header-buttons">
        <a href="/admin" class="admin-btn">管理</a>
        <a href="/admin/login" class="login-btn">登录</a>
    </div>
    
    <div class="content">
        <div class="moments-container">
            ${posts.map((post, index) => `
                ${index > 0 ? '<div class="divider"></div>' : ''}
                <div class="post">
                    <div class="post-header">
                        <div class="avatar"></div>
                        <div class="user-info">
                            <div class="username">钟神秀</div>
                            <div class="post-date">${post.date}</div>
                        </div>
                        <div class="more-options"></div>
                    </div>
                    <div class="post-content" data-markdown="${encodeURIComponent(post.content)}"></div>
                    <div class="post-tags">
                        ${post.tags.map(tag => `<span class="tag">#${tag}</span>`).join('')}
                    </div>
                    <div class="post-footer">
                        <!-- 移除了赞、评论、分享按钮 -->
                    </div>
                </div>
            `).join('')}
        </div>
    </div>

    <script>
        // 渲染 Markdown 内容
        document.querySelectorAll('.post-content').forEach(element => {
            const markdown = decodeURIComponent(element.dataset.markdown);
            element.innerHTML = marked.parse(markdown);
        });
        
        // 初始化 more-options 图标颜色
        function updateMoreOptionsIcon() {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const color = isDark ? '%23b0b0b0' : '%23999';
            const svgUrl = 'url(data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="' + color + '"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>');
            document.querySelectorAll('.more-options').forEach(el => {
                el.style.backgroundImage = svgUrl;
            });
        }
        
        // 监听主题切换事件
        const observer = new MutationObserver(updateMoreOptionsIcon);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
        
        // 初始设置图标
        updateMoreOptionsIcon();
    </script>
    
    ${getThemeToggleScript()}
    
    <!-- 主题切换按钮 -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}
