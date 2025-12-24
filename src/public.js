import { getAllPosts } from './utils.js';
import { getFile, getFileUrl } from './storage.js';
import { getThemeToggleHTML, getThemeToggleScript, getThemeCSS } from './theme.js';

export async function handlePublic(request, env, dbWrapper = null) {
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

  // 主页展示 - 使用数据库包装器
  const posts = dbWrapper ? await dbWrapper.getAllPosts() : await getAllPosts(env.POSTS_KV);
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
        
        /* 图片九宫格容器 */
        .image-grid {
            display: grid;
            gap: 4px;
            margin-top: 10px;
            border-radius: 6px;
            overflow: hidden;
            width: 100%;
        }

        .image-grid.grid-1 {
            width: 33%;
        }

        /* 根据图片数量设置网格布局 */
        .image-grid.grid-1 { grid-template-columns: 1fr; }
        .image-grid.grid-2 { grid-template-columns: repeat(2, 1fr); }
        .image-grid.grid-3 { grid-template-columns: repeat(3, 1fr); }
        .image-grid.grid-4 { grid-template-columns: repeat(2, 1fr); }
        .image-grid.grid-5,
        .image-grid.grid-6 { grid-template-columns: repeat(3, 1fr); }
        .image-grid.grid-7,
        .image-grid.grid-8,
        .image-grid.grid-9 { grid-template-columns: repeat(3, 1fr); }

        /* 单张大图样式 */
        .image-grid.grid-1 img {
            max-width: 33%;
            max-height: 500px;
            object-fit: contain;
        }

        /* 多张图片样式 */
        .image-grid:not(.grid-1) img {
            width: 100%;
            aspect-ratio: 1;
            object-fit: cover;
        }

        .image-grid img {
            border-radius: 4px;
            cursor: pointer;
            transition: transform 0.2s;
            margin: 0 !important;
            display: block !important;
        }

        .image-grid img:hover {
            transform: scale(1.02);
        }

        /* 不在九宫格中的图片样式 */
        .post-content > p > img,
        .post-content > img {
            max-width: 100%;
            border-radius: 6px;
            margin: 10px 0;
            cursor: pointer;
        }

        /* Lightbox 灯箱样式 */
        .lightbox {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            z-index: 9999;
            justify-content: center;
            align-items: center;
            opacity: 0;
            transition: opacity 0.3s;
        }

        .lightbox.active {
            display: flex;
            opacity: 1;
        }

        .lightbox-content {
            max-width: 90%;
            max-height: 90%;
            object-fit: contain;
            cursor: zoom-in;
            transition: transform 0.3s ease;
        }

        .lightbox.zoomed .lightbox-content {
            max-width: 95%;
            max-height: 95%;
            transform: scale(1.5);
        }

        .lightbox-close {
            position: absolute;
            top: 20px;
            right: 30px;
            font-size: 40px;
            color: white;
            cursor: pointer;
            z-index: 10000;
            user-select: none;
            line-height: 1;
        }

        .lightbox-close:hover {
            opacity: 0.8;
        }

        .lightbox-nav {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            font-size: 40px;
            color: white;
            cursor: pointer;
            z-index: 10000;
            user-select: none;
            padding: 20px;
            line-height: 1;
        }

        .lightbox-prev {
            left: 10px;
        }

        .lightbox-next {
            right: 10px;
        }

        .lightbox-nav:hover {
            opacity: 0.8;
        }

        .lightbox-nav.hidden {
            display: none;
        }

        .lightbox-counter {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: white;
            font-size: 14px;
            z-index: 10000;
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
        // 创建 Lightbox 灯箱
        const lightbox = document.createElement('div');
        lightbox.className = 'lightbox';
        lightbox.innerHTML = '<span class="lightbox-close">&times;</span>' +
            '<span class="lightbox-nav lightbox-prev">&lt;</span>' +
            '<span class="lightbox-nav lightbox-next">&gt;</span>' +
            '<img class="lightbox-content" src="">' +
            '<span class="lightbox-counter"></span>';
        document.body.appendChild(lightbox);

        let currentImages = [];
        let currentIndex = 0;

        function openLightbox(src) {
            lightbox.classList.add('active');
            document.body.style.overflow = 'hidden';
            updateLightboxImage(src);
            updateNavigation();
        }

        function closeLightbox() {
            lightbox.classList.remove('active');
            document.body.style.overflow = '';
        }

        function updateLightboxImage(src) {
            const content = lightbox.querySelector('.lightbox-content');
            content.src = src;
        }

        function updateNavigation() {
            const prev = lightbox.querySelector('.lightbox-prev');
            const next = lightbox.querySelector('.lightbox-next');
            const counter = lightbox.querySelector('.lightbox-counter');

            prev.classList.toggle('hidden', currentIndex === 0);
            next.classList.toggle('hidden', currentIndex === currentImages.length - 1);
            counter.textContent = currentImages.length > 1 ? (currentIndex + 1) + ' / ' + currentImages.length : '';
        }

        function showPrev() {
            if (currentIndex > 0) {
                currentIndex--;
                updateLightboxImage(currentImages[currentIndex].src);
                updateNavigation();
            }
        }

        function showNext() {
            if (currentIndex < currentImages.length - 1) {
                currentIndex++;
                updateLightboxImage(currentImages[currentIndex].src);
                updateNavigation();
            }
        }

        // 图片点击处理
        function handleImageClick(e) {
            e.preventDefault();
            const img = this;
            const grid = img.closest('.image-grid');
            if (grid) {
                currentImages = Array.from(grid.querySelectorAll('img'));
            } else {
                currentImages = [img];
            }
            currentIndex = currentImages.indexOf(img);
            openLightbox(img.src);
        }

        // Lightbox 事件监听
        lightbox.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
        lightbox.querySelector('.lightbox-prev').addEventListener('click', showPrev);
        lightbox.querySelector('.lightbox-next').addEventListener('click', showNext);

        lightbox.addEventListener('click', function(e) {
            if (e.target === lightbox) {
                closeLightbox();
            }
        });

        // 点击图片切换缩放
        lightbox.querySelector('.lightbox-content').addEventListener('click', function(e) {
            e.stopPropagation();
            lightbox.classList.toggle('zoomed');
        });

        // 键盘导航
        document.addEventListener('keydown', function(e) {
            if (!lightbox.classList.contains('active')) return;
            if (e.key === 'Escape') closeLightbox();
            if (e.key === 'ArrowLeft') showPrev();
            if (e.key === 'ArrowRight') showNext();
        });

        // 处理图片九宫格
        function processImages(contentElement) {
            const images = contentElement.querySelectorAll('img');
            if (images.length === 0) return;

            // 收集所有图片
            const allImages = Array.from(images);

            // 创建九宫格容器
            const gridClass = 'grid-' + Math.min(allImages.length, 9);
            const grid = document.createElement('div');
            grid.className = 'image-grid ' + gridClass;

            // 将所有图片移动到九宫格容器
            allImages.forEach(img => {
                grid.appendChild(img);
                img.addEventListener('click', handleImageClick);
            });

            // 将九宫格添加到内容末尾
            contentElement.appendChild(grid);
        }

        // 初始化页面
        function initPage() {
            // 渲染 Markdown 内容
            document.querySelectorAll('.post-content').forEach(element => {
                const markdown = decodeURIComponent(element.dataset.markdown);
                element.innerHTML = marked.parse(markdown);
            });

            // 图片九宫格处理
            document.querySelectorAll('.post-content').forEach(element => {
                processImages(element);
            });
        }

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

        // 初始设置
        updateMoreOptionsIcon();
        initPage();
    </script>
    
    ${getThemeToggleScript()}
    
    <!-- 主题切换按钮 -->
    ${getThemeToggleHTML()}
</body>
</html>`;
}
