// 主题切换工具函数
export function getThemeToggleHTML() {
  return `
    <div class="theme-toggle" id="theme-toggle" title="切换深色/浅色模式">
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

export function getThemeToggleScript() {
  return `
    <script>
      (function() {
        console.log('Theme script loading...');
        
        // 等待DOM完全加载
        function initThemeToggle() {
          console.log('Initializing theme toggle...');
          
          // 获取主题切换按钮
          const themeToggle = document.getElementById('theme-toggle');
          console.log('Theme toggle element:', themeToggle);
          
          if (!themeToggle) {
            console.log('Theme toggle button not found, retrying in 100ms...');
            setTimeout(initThemeToggle, 100);
            return;
          }
          
          // 更新图标显示的函数
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
          
          // 获取或初始化主题
          const currentTheme = localStorage.getItem('theme') || 'light';
          console.log('Current theme:', currentTheme);
          document.documentElement.setAttribute('data-theme', currentTheme);
          updateIcon(currentTheme);
          
          // 添加点击事件
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
        
        // 立即初始化，如果DOM还没准备好就等待
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initThemeToggle);
        } else {
          initThemeToggle();
        }
      })();
    <\/script>
  `;
}

export function getThemeCSS() {
  return `
    /* 主题切换按钮样式 */
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
    
    /* 深色模式样式 */
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
    
    /* 应用主题变量到现有样式 */
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
    
    /* 链接样式 */
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