/**
 * @fileoverview 云存储适配器示例
 *
 * 展示 S3、OSS、COS 云存储的使用
 */

// ============================================================================
// AWS S3 存储
// ============================================================================

console.log("=== AWS S3 存储 ===\n");

console.log(`
import { S3Adapter } from "@dreamer/upload/adapters";

// 创建 S3 适配器
const s3 = new S3Adapter({
  accessKeyId: "your-access-key-id",
  secretAccessKey: "your-secret-access-key",
  region: "us-east-1",
  bucket: "my-bucket",
  endpoint: undefined, // 使用默认 AWS 端点
});

// 上传文件
await s3.upload("images/photo.jpg", imageData, {
  contentType: "image/jpeg",
  metadata: {
    "x-amz-meta-user-id": "12345",
  },
  acl: "public-read",
});

// 下载文件
const data = await s3.download("images/photo.jpg");

// 获取预签名 URL（临时访问链接）
const url = await s3.getSignedUrl("images/photo.jpg", {
  expiresIn: 3600, // 1 小时
});
console.log("预签名 URL:", url);

// 删除文件
await s3.delete("images/photo.jpg");

// 列出文件
const files = await s3.list("images/");
console.log("文件列表:", files);
`);

// ============================================================================
// 阿里云 OSS 存储
// ============================================================================

console.log("=== 阿里云 OSS 存储 ===\n");

console.log(`
import { OSSAdapter } from "@dreamer/upload/adapters";

// 创建 OSS 适配器
const oss = new OSSAdapter({
  accessKeyId: "your-access-key-id",
  accessKeySecret: "your-access-key-secret",
  region: "oss-cn-hangzhou",
  bucket: "my-bucket",
  internal: false, // 是否使用内网
});

// 上传文件
await oss.upload("images/photo.jpg", imageData, {
  contentType: "image/jpeg",
  headers: {
    "x-oss-object-acl": "public-read",
  },
});

// 下载文件
const data = await oss.download("images/photo.jpg");

// 获取签名 URL
const url = await oss.getSignedUrl("images/photo.jpg", {
  expiresIn: 3600,
});

// 获取公开访问 URL
const publicUrl = oss.getPublicUrl("images/photo.jpg");
console.log("公开 URL:", publicUrl);
`);

// ============================================================================
// 腾讯云 COS 存储
// ============================================================================

console.log("=== 腾讯云 COS 存储 ===\n");

console.log(`
import { COSAdapter } from "@dreamer/upload/adapters";

// 创建 COS 适配器
const cos = new COSAdapter({
  secretId: "your-secret-id",
  secretKey: "your-secret-key",
  region: "ap-guangzhou",
  bucket: "my-bucket-1250000000",
});

// 上传文件
await cos.upload("images/photo.jpg", imageData, {
  contentType: "image/jpeg",
});

// 下载文件
const data = await cos.download("images/photo.jpg");

// 获取预签名 URL
const url = await cos.getSignedUrl("images/photo.jpg", {
  expiresIn: 3600,
});

// 删除文件
await cos.delete("images/photo.jpg");
`);

// ============================================================================
// 与 Uploader 集成
// ============================================================================

console.log("=== 与 Uploader 集成 ===\n");

console.log(`
import { Uploader } from "@dreamer/upload";
import { S3Adapter } from "@dreamer/upload/adapters";

// 创建云存储适配器
const cloudStorage = new S3Adapter({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  region: "us-east-1",
  bucket: "my-uploads",
});

// 创建上传处理器
const uploader = new Uploader({
  storage: cloudStorage,
  validation: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedMimeTypes: ["image/*", "video/*"],
  },
  generateFilename: true,
  dateSubDir: true,
});

// 处理上传
async function handleUpload(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File;

  const result = await uploader.uploadFile(file);

  // 获取公开访问 URL
  const publicUrl = cloudStorage.getPublicUrl(result.path);

  return {
    filename: result.filename,
    size: result.size,
    url: publicUrl,
  };
}
`);

// ============================================================================
// 分片上传到云存储
// ============================================================================

console.log("=== 分片上传到云存储 ===\n");

console.log(`
import { MultipartUploader } from "@dreamer/upload";
import { S3Adapter } from "@dreamer/upload/adapters";

const s3 = new S3Adapter({ /* 配置 */ });

const uploader = new MultipartUploader({
  partSize: 10 * 1024 * 1024, // 10MB 分片
  concurrency: 5,
});

// 上传大文件到 S3
const result = await uploader.upload({
  file: largeFile,
  key: "videos/large-video.mp4",
  storage: s3,

  onProgress: (progress) => {
    console.log(\`上传进度: \${progress.percentage.toFixed(1)}%\`);
  },
});

console.log("上传完成:", result.key);
`);

// ============================================================================
// CDN 集成
// ============================================================================

console.log("=== CDN 集成 ===\n");

console.log(`
// 配置 CDN 域名
const s3 = new S3Adapter({
  // ... S3 配置
  cdnDomain: "https://cdn.example.com",
});

// 上传后获取 CDN URL
const result = await uploader.upload(content, "image.jpg", "image/jpeg");
const cdnUrl = s3.getCdnUrl(result.path);
console.log("CDN URL:", cdnUrl);
// 输出: https://cdn.example.com/uploads/2024/01/15/abc123.jpg
`);

// ============================================================================
// 跨域配置
// ============================================================================

console.log("=== 前端直传（跨域配置）===\n");

console.log(`
// 后端：生成预签名上传 URL
router.post("/api/upload/presign", async (ctx) => {
  const { filename, contentType } = await ctx.request.body().value;

  // 生成唯一路径
  const key = \`uploads/\${Date.now()}_\${filename}\`;

  // 获取预签名上传 URL
  const uploadUrl = await s3.getSignedUploadUrl(key, {
    contentType,
    expiresIn: 3600,
    conditions: [
      ["content-length-range", 0, 50 * 1024 * 1024], // 最大 50MB
    ],
  });

  ctx.response.body = { uploadUrl, key };
});

// 前端：直接上传到 S3
async function uploadDirect(file: File) {
  // 1. 获取预签名 URL
  const { uploadUrl, key } = await fetch("/api/upload/presign", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
    }),
  }).then(r => r.json());

  // 2. 直接上传到 S3
  await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type,
    },
  });

  return key;
}
`);

// ============================================================================
// 多云存储策略
// ============================================================================

console.log("=== 多云存储策略 ===\n");

console.log(`
// 根据文件类型选择存储
function getStorage(mimeType: string): CloudStorageAdapter {
  if (mimeType.startsWith("video/")) {
    // 视频使用阿里云 OSS（价格更优）
    return ossAdapter;
  } else if (mimeType.startsWith("image/")) {
    // 图片使用 CDN 加速的 S3
    return s3Adapter;
  } else {
    // 其他文件使用腾讯云 COS
    return cosAdapter;
  }
}

// 使用
const storage = getStorage(file.type);
await storage.upload(path, content);
`);
