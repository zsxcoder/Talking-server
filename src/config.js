// 应用配置文件
export const AppConfig = {
  // 数据库配置
  database: {
    // 最大保留文章数量（自动清理时保留最新的 N 篇文章）
    MAX_POSTS_TO_KEEP: 30,

    // 单次最多删除文章数（安全限制，防止误删过多）
    MAX_DELETE_LIMIT: 50,

    // 是否启用自动清理
    AUTO_CLEANUP_ENABLED: true,
  },

  // 存储配置
  storage: {
    // 存储桶名称
    bucketName: 'talk',
  },

  // 会话配置
  session: {
    // 会话过期时间（秒），默认 7 天
    EXPIRY_SECONDS: 604800,
  },

  // 日期配置
  datetime: {
    // 时区偏移（分钟），北京时间 UTC+8
    TIMEZONE_OFFSET: 8 * 60,

    // 日期格式
    DATE_FORMAT: 'YYYY-MM-DD HH:mm:ss',
  },

  // 安全配置
  security: {
    // 迁移令牌（建议使用环境变量，在 wrangler.toml 中配置）
    MIGRATION_TOKEN: 'migration-token-please-change-me',
  },
};

// 导出常用配置常量
export const MAX_POSTS_TO_KEEP = AppConfig.database.MAX_POSTS_TO_KEEP;
export const MAX_DELETE_LIMIT = AppConfig.database.MAX_DELETE_LIMIT;
export const AUTO_CLEANUP_ENABLED = AppConfig.database.AUTO_CLEANUP_ENABLED;
