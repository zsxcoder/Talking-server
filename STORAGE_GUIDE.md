# 存储服务配置指南

本项目现在支持两种存储服务：
1. Cloudflare R2（默认）
2. 阿里云 OSS

## Cloudflare R2（默认配置）

R2 是 Cloudflare 提供的 S3 兼容对象存储服务，默认已经配置好，无需额外操作。

## 阿里云 OSS 配置

如果您想使用阿里云 OSS 替代 R2，请按照以下步骤操作：

### 1. 注册阿里云并创建 OSS 存储桶

1. 登录 [阿里云控制台](https://oss.console.aliyun.com/)
2. 创建一个新的存储桶（Bucket）
3. 记录存储桶名称、区域等信息

### 2. 获取访问密钥

1. 在阿里云控制台创建 AccessKey
2. 记录 AccessKey ID 和 AccessKey Secret

### 3. 更新环境变量

在 `wrangler.toml` 文件中，更新以下配置：

```toml
[vars]
# ... 其他配置 ...
STORAGE_TYPE = "OSS"
OSS_REGION = "oss-cn-hangzhou"  # 替换为您的 OSS 区域
OSS_BUCKET = "your-bucket-name"  # 替换为您的存储桶名称
OSS_ACCESS_KEY_ID = "your-access-key-id"  # 替换为您的 AccessKey ID
OSS_ACCESS_KEY_SECRET = "your-access-key-secret"  # 替换为您的 AccessKey Secret
# OSS_DOMAIN = "your-custom-domain.com"  # 可选，自定义域名
```

### 4. 部署更新

```bash
wrangler deploy
```

## 注意事项

1. **切换存储服务不会影响已上传的文件**，但新上传的文件会存储到新配置的服务中
2. 如果您之前使用 R2 存储了文件，切换到 OSS 后，这些文件将无法访问
3. 阿里云 OSS 可能会产生流量和存储费用，请查看 [阿里云 OSS 价格表](https://www.aliyun.com/price/product?spm=5176.11094001.1114502.8.65e614e9IY7G6w#/oss/detail)
4. 如果您配置了自定义域名（OSS_DOMAIN），确保域名已正确解析到 OSS

## 如何切换存储服务

只需修改 `wrangler.toml` 文件中的 `STORAGE_TYPE` 变量：

- 使用 R2：`STORAGE_TYPE = "R2"`
- 使用 OSS：`STORAGE_TYPE = "OSS"`

然后重新部署：

```bash
wrangler deploy
```

## 故障排除

### OSS 上传失败

如果遇到 OSS 上传失败，请检查：

1. 环境变量是否正确配置
2. AccessKey 是否有足够的权限
3. 存储桶是否存在
4. 区域是否正确

### 图片无法显示

1. 检查存储服务配置是否正确
2. 确认文件已成功上传
3. 检查 CORS 设置（如果使用自定义域名）

如有其他问题，请查看 Cloudflare Workers 的日志。