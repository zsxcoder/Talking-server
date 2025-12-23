/**
 * 存储服务抽象层，支持 Cloudflare R2 和阿里云 OSS
 */

/**
 * 上传文件到存储服务
 * @param {Object} options - 上传选项
 * @param {ReadableStream} options.stream - 文件流
 * @param {string} options.key - 文件键名/路径
 * @param {string} options.contentType - 文件类型
 * @param {Object} env - 环境变量
 * @param {string} env.STORAGE_TYPE - 存储类型 ('R2' 或 'OSS')
 * @param {Object} env.POST_BUCKET - R2 存储桶
 * @param {string} env.OSS_REGION - OSS 区域
 * @param {string} env.OSS_BUCKET - OSS 存储桶名
 * @param {string} env.OSS_ACCESS_KEY_ID - OSS 访问密钥 ID
 * @param {string} env.OSS_ACCESS_KEY_SECRET - OSS 访问密钥
 * @returns {Promise<string>} 文件的 URL
 */
export async function uploadFile({ stream, key, contentType }, env) {
  const storageType = env.STORAGE_TYPE || 'R2';
  
  if (storageType === 'R2') {
    return uploadToR2({ stream, key, contentType }, env);
  } else if (storageType === 'OSS') {
    return uploadToOSS({ stream, key, contentType }, env);
  } else {
    throw new Error(`不支持的存储类型: ${storageType}`);
  }
}

/**
 * 从存储服务获取文件
 * @param {string} key - 文件键名/路径
 * @param {Object} env - 环境变量
 * @returns {Promise<Object|null>} 文件对象或 null
 */
export async function getFile(key, env) {
  const storageType = env.STORAGE_TYPE || 'R2';
  
  if (storageType === 'R2') {
    return getFromR2(key, env);
  } else if (storageType === 'OSS') {
    return getFromOSS(key, env);
  } else {
    throw new Error(`不支持的存储类型: ${storageType}`);
  }
}

/**
 * 获取文件的公开 URL
 * @param {string} key - 文件键名/路径
 * @param {Object} env - 环境变量
 * @param {Object} request - 请求对象，用于构建 URL
 * @returns {string} 文件的公开 URL
 */
export async function getFileUrl(key, env, request) {
  const storageType = env.STORAGE_TYPE || 'R2';
  
  if (storageType === 'R2') {
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}/images/${key}`;
  } else if (storageType === 'OSS') {
    // OSS 需要根据配置构建公开 URL
    const domain = env.OSS_DOMAIN || `${env.OSS_BUCKET}.${env.OSS_REGION}.aliyuncs.com`;
    return `https://${domain}/${key}`;
  } else {
    throw new Error(`不支持的存储类型: ${storageType}`);
  }
}

/**
 * 上传文件到 Cloudflare R2
 * @private
 */
async function uploadToR2({ stream, key, contentType }, env) {
  const uploadResult = await env.POST_BUCKET.put(key, stream, {
    httpMetadata: {
      contentType: contentType || 'image/jpeg'
    }
  });
  
  if (!uploadResult) {
    throw new Error('上传到 R2 失败');
  }
  
  return key; // R2 返回键名，后续通过 getFileUrl 获取完整 URL
}

/**
 * 从 Cloudflare R2 获取文件
 * @private
 */
async function getFromR2(key, env) {
  return await env.POST_BUCKET.get(key);
}

/**
 * 上传文件到阿里云 OSS
 * @private
 */
async function uploadToOSS({ stream, key, contentType }, env) {
  const {
    OSS_REGION,
    OSS_BUCKET,
    OSS_ACCESS_KEY_ID,
    OSS_ACCESS_KEY_SECRET
  } = env;
  
  if (!OSS_REGION || !OSS_BUCKET || !OSS_ACCESS_KEY_ID || !OSS_ACCESS_KEY_SECRET) {
    throw new Error('OSS 配置不完整');
  }
  
  // 将流转为 ArrayBuffer
  const arrayBuffer = await streamToArrayBuffer(stream);
  
  // 构建 OSS 请求
  const host = `${OSS_BUCKET}.${OSS_REGION}.aliyuncs.com`;
  const date = new Date().toUTCString();
  const contentTypeValue = contentType || 'image/jpeg';
  
  // 计算签名
  const stringToSign = `PUT\n\n${contentTypeValue}\n${date}\n/${OSS_BUCKET}/${key}`;
  const signature = await generateSignature(stringToSign, OSS_ACCESS_KEY_SECRET);
  
  const response = await fetch(`https://${host}/${key}`, {
    method: 'PUT',
    headers: {
      'Host': host,
      'Date': date,
      'Content-Type': contentTypeValue,
      'Authorization': `OSS ${OSS_ACCESS_KEY_ID}:${signature}`,
      'Content-Length': arrayBuffer.byteLength.toString()
    },
    body: arrayBuffer
  });
  
  if (!response.ok) {
    throw new Error(`OSS 上传失败: ${response.status} ${response.statusText}`);
  }
  
  return key; // OSS 返回键名，后续通过 getFileUrl 获取完整 URL
}

/**
 * 从阿里云 OSS 获取文件
 * @private
 */
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
      contentType: response.headers.get('content-type') || 'image/jpeg'
    }
  };
}

/**
 * 将 ReadableStream 转换为 ArrayBuffer
 * @private
 */
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

/**
 * 生成阿里云 OSS 签名
 * @private
 */
async function generateSignature(stringToSign, accessKeySecret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(accessKeySecret);
  const messageData = encoder.encode(stringToSign);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  const signature = Array.from(new Uint8Array(signatureBuffer))
    .map(b => String.fromCharCode(b))
    .join('');
  
  return btoa(signature);
}