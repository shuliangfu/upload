/**
 * @fileoverview 文件上传客户端示例
 *
 * 使用 @dreamer/upload/client 模块进行文件上传
 *
 * 运行命令：deno run -A examples/client.ts
 */

import {
  UploadClient,
  createUploadClient,
  type UploadProgress,
  type UploadResult,
  type UploadState,
} from "../src/client/mod.ts";

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 格式化文件大小
 *
 * @param bytes - 字节数
 * @returns 格式化的大小字符串
 */
function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * 格式化时间
 *
 * @param ms - 毫秒数
 * @returns 格式化的时间字符串
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// ============================================================================
// 创建上传客户端
// ============================================================================

console.log("=== 创建上传客户端 ===\n");

// 方式一：直接实例化
const client = new UploadClient({
  endpoint: "http://localhost:3000/upload",
  chunkSize: 5 * 1024 * 1024, // 5MB 分片
  concurrency: 3,             // 3 并发
  retries: 3,                 // 重试 3 次
  timeout: 30000,             // 30 秒超时
  headers: {
    "X-Client": "deno-upload-client",
  },
});

console.log("上传客户端创建成功");

// 方式二：使用工厂函数
const _client2 = createUploadClient({
  endpoint: "http://localhost:3000/upload",
  token: "your-auth-token", // 自动添加 Authorization 头
});

console.log("工厂函数创建成功");

// ============================================================================
// 简单上传示例
// ============================================================================

console.log("\n=== 简单上传示例 ===\n");

// 创建测试文件
const testContent = new TextEncoder().encode("Hello, World! 这是测试文件内容。");
const testFile = new File([testContent], "test.txt", { type: "text/plain" });

console.log("测试文件:");
console.log("  名称:", testFile.name);
console.log("  大小:", formatSize(testFile.size));
console.log("  类型:", testFile.type);

// 简单上传（无进度回调）
console.log("\n开始上传...");

try {
  const result = await client.upload(testFile);

  if (result.success) {
    console.log("\n上传成功!");
    console.log("  文件ID:", result.fileId);
    console.log("  URL:", result.url);
    console.log("  大小:", formatSize(result.size));
    console.log("  耗时:", formatDuration(result.duration));
  } else {
    console.log("\n上传失败:", result.error);
  }
} catch (error) {
  console.log("上传出错:", (error as Error).message);
}

// ============================================================================
// 带进度回调的上传
// ============================================================================

console.log("\n=== 带进度回调的上传 ===\n");

// 创建较大的测试文件
const largeContent = new Uint8Array(1024 * 1024); // 1MB
for (let i = 0; i < largeContent.length; i++) {
  largeContent[i] = i % 256;
}
const largeFile = new File([largeContent], "large-file.bin", {
  type: "application/octet-stream",
});

console.log("大文件:");
console.log("  名称:", largeFile.name);
console.log("  大小:", formatSize(largeFile.size));

/**
 * 进度回调函数
 *
 * @param progress - 上传进度信息
 */
function onProgress(progress: UploadProgress): void {
  const bar = "█".repeat(Math.floor(progress.percentage / 5)) +
    "░".repeat(20 - Math.floor(progress.percentage / 5));

  console.log(
    `[${bar}] ${progress.percentage.toFixed(1)}% ` +
    `(${formatSize(progress.loaded)}/${formatSize(progress.total)}) ` +
    `速度: ${formatSize(progress.speed)}/s ` +
    `分片: ${progress.completedChunks}/${progress.totalChunks}`
  );
}

console.log("\n开始上传...");

try {
  const result = await client.upload(largeFile, {
    onProgress,
    metadata: {
      description: "测试大文件上传",
      uploadedBy: "client-example",
    },
  });

  if (result.success) {
    console.log("\n上传成功!");
    console.log("  文件ID:", result.fileId);
    console.log("  耗时:", formatDuration(result.duration));
  } else {
    console.log("\n上传失败:", result.error);
  }
} catch (error) {
  console.log("上传出错:", (error as Error).message);
}

// ============================================================================
// 取消上传示例
// ============================================================================

console.log("\n=== 取消上传示例 ===\n");

console.log(`
// 取消上传示例代码

// 开始上传
const result = await client.upload(largeFile, {
  onProgress: (p) => {
    console.log(\`进度: \${p.percentage}%\`);
    
    // 在某个条件下取消
    if (shouldCancel) {
      client.cancel(uploadId);
    }
  },
});

// 或者使用 AbortController（需要服务端支持）
const controller = new AbortController();

setTimeout(() => controller.abort(), 5000); // 5秒后取消

try {
  const result = await fetch(uploadUrl, {
    method: "POST",
    body: formData,
    signal: controller.signal,
  });
} catch (error) {
  if (error.name === "AbortError") {
    console.log("上传已取消");
  }
}
`);

// ============================================================================
// 断点续传示例
// ============================================================================

console.log("=== 断点续传示例 ===\n");

// 创建支持断点续传的客户端
const _resumableClient = new UploadClient({
  endpoint: "http://localhost:3000/upload",
  chunkSize: 1024 * 1024, // 1MB 分片
  persistState: true,     // 启用状态持久化
  stateKeyPrefix: "upload_", // 状态存储键前缀
});

console.log("断点续传客户端创建成功");
console.log("状态持久化: 已启用");

// 模拟断点续传流程
console.log(`
断点续传使用示例：

// 1. 开始上传（状态会自动保存）
const result = await resumableClient.upload(largeFile, {
  onProgress: (p) => console.log(\`\${p.percentage}%\`),
  
  onStateChange: (state) => {
    // 状态自动保存
    console.log("当前状态:", state.status);
    console.log("分片完成:", state.chunks.filter(c => c.status === "completed").length);
  },
});

// 2. 如果上传中断，下次启动时会自动检测并恢复
//    - persistState: true 会在浏览器中使用 localStorage
//    - 相同文件（通过哈希识别）会自动从断点继续

// 3. 查看未完成的上传
const pending = await resumableClient.getPendingUploads();
console.log("未完成的上传:", pending);

// 4. 手动恢复上传
if (pending.length > 0) {
  const resumeResult = await resumableClient.resume(pending[0].id, file);
}
`);

// ============================================================================
// 状态变化回调示例
// ============================================================================

console.log("=== 状态变化回调示例 ===\n");

/**
 * 状态变化回调函数
 *
 * @param state - 上传状态
 */
function onStateChange(state: UploadState): void {
  const completedChunks = state.chunks.filter(c => c.status === "completed").length;
  const totalChunks = state.chunks.length;

  console.log(`状态变化: ${state.status}`);
  console.log(`  上传ID: ${state.id}`);
  console.log(`  文件名: ${state.filename}`);
  console.log(`  分片进度: ${completedChunks}/${totalChunks}`);
}

console.log("开始上传（带状态回调）...");

try {
  const result = await client.upload(testFile, {
    onStateChange,
    onProgress: (p) => {
      console.log(`  进度: ${p.percentage}%`);
    },
  });

  if (result.success) {
    console.log("上传完成!");
  }
} catch (error) {
  console.log("上传出错:", (error as Error).message);
}

// ============================================================================
// 完整上传流程示例
// ============================================================================

console.log("\n=== 完整上传流程示例 ===\n");

/**
 * 完整的文件上传函数示例
 *
 * @param file - 要上传的文件
 * @param uploadClient - 上传客户端
 * @returns 上传结果
 */
async function uploadFileWithFullFeatures(
  file: File,
  uploadClient: UploadClient
): Promise<UploadResult> {
  console.log(`开始上传: ${file.name}`);
  console.log(`文件大小: ${formatSize(file.size)}`);

  const startTime = Date.now();
  let lastLoaded = 0;
  let lastTime = startTime;

  const result = await uploadClient.upload(file, {
    // 自定义文件名
    filename: `${Date.now()}_${file.name}`,

    // 目标路径
    path: "uploads/images",

    // 自定义元数据
    metadata: {
      originalName: file.name,
      uploadTime: new Date().toISOString(),
      clientVersion: "1.0.0",
    },

    // 进度回调
    onProgress: (progress: UploadProgress) => {
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;
      const loadedDiff = progress.loaded - lastLoaded;
      const currentSpeed = timeDiff > 0 ? loadedDiff / timeDiff : 0;

      console.log(
        `进度: ${progress.percentage.toFixed(1)}% | ` +
        `已传: ${formatSize(progress.loaded)} | ` +
        `速度: ${formatSize(currentSpeed)}/s | ` +
        `状态: ${progress.status}`
      );

      lastLoaded = progress.loaded;
      lastTime = now;
    },

    // 状态变化回调
    onStateChange: (state: UploadState) => {
      const completedChunks = state.chunks.filter(c => c.status === "completed").length;
      console.log(
        `分片进度: ${completedChunks}/${state.chunks.length} | ` +
        `状态: ${state.status}`
      );
    },
  });

  const totalTime = Date.now() - startTime;

  if (result.success) {
    console.log(`\n上传成功!`);
    console.log(`  文件ID: ${result.fileId}`);
    console.log(`  URL: ${result.url}`);
    console.log(`  总耗时: ${formatDuration(totalTime)}`);
    console.log(`  平均速度: ${formatSize(file.size / (totalTime / 1000))}/s`);
  } else {
    console.log(`\n上传失败: ${result.error}`);
  }

  return result;
}

// 执行完整上传示例
try {
  await uploadFileWithFullFeatures(testFile, client);
} catch (error) {
  console.log("上传出错:", (error as Error).message);
}

console.log("\n=== 示例运行完成 ===");
