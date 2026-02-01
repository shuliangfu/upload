/**
 * @fileoverview 文件上传服务端示例
 *
 * 使用 Deno 原生 HTTP 服务器处理文件上传
 *
 * 运行命令：deno run -A examples/server.ts
 */

import {
  Uploader,
  LocalStorage,
  validateFile,
  formatFileSize,
  generateDateSubdir,
  createFileResponse,
} from "../src/mod.ts";

// ============================================================================
// 配置
// ============================================================================

/** 上传目录 */
const UPLOAD_DIR = "./uploads";

/** 服务端口 */
const PORT = 3000;

// ============================================================================
// 创建上传处理器
// ============================================================================

// 创建存储
const storage = new LocalStorage();

// 创建上传器
const uploader = new Uploader({
  uploadDir: UPLOAD_DIR,
  storage,
  validation: {
    maxFileSize: 50 * 1024 * 1024, // 50MB
    allowedMimeTypes: ["image/*", "video/*", "application/pdf"],
    allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".pdf"],
  },
  // 按日期分目录
  generateSubdir: generateDateSubdir,
});

// 初始化上传目录
await uploader.init();

console.log(`上传目录: ${UPLOAD_DIR}`);

// ============================================================================
// 请求处理器
// ============================================================================

/**
 * 处理文件上传请求
 *
 * @param request - HTTP 请求
 * @returns HTTP 响应
 */
async function handleUpload(request: Request): Promise<Response> {
  // 检查 Content-Type
  const contentType = request.headers.get("content-type") || "";

  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { success: false, error: "请使用 multipart/form-data 格式上传" },
      { status: 400 }
    );
  }

  try {
    // 解析 FormData
    const formData = await request.formData();

    // 处理上传
    const result = await uploader.handleFormData(formData);

    if (!result.success) {
      return Response.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    // 返回上传结果
    return Response.json({
      success: true,
      count: result.count,
      totalSize: result.totalSize,
      files: result.files.map((file) => ({
        originalName: file.originalName,
        filename: file.filename,
        path: file.path,
        size: file.size,
        sizeFormatted: formatFileSize(file.size),
        mimeType: file.mimeType,
        url: `/files/${file.filename}`,
      })),
    });
  } catch (error) {
    console.error("上传错误:", error);
    return Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 处理单文件上传（通过 body 直接上传）
 *
 * @param request - HTTP 请求
 * @returns HTTP 响应
 */
async function handleRawUpload(request: Request): Promise<Response> {
  try {
    // 获取文件名
    const filename = request.headers.get("x-filename") || "upload";
    const mimeType = request.headers.get("content-type") || "application/octet-stream";

    // 验证文件类型
    const validation = validateFile(
      { name: filename, type: mimeType, size: 0 },
      uploader.getValidation()
    );

    if (!validation.valid) {
      return Response.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    // 读取文件内容
    const content = new Uint8Array(await request.arrayBuffer());

    // 上传
    const file = await uploader.upload(content, filename, mimeType);

    return Response.json({
      success: true,
      file: {
        originalName: file.originalName,
        filename: file.filename,
        path: file.path,
        size: file.size,
        sizeFormatted: formatFileSize(file.size),
        mimeType: file.mimeType,
        url: `/files/${file.filename}`,
      },
    });
  } catch (error) {
    console.error("上传错误:", error);
    return Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 处理文件下载/访问请求
 *
 * @param filename - 文件名
 * @returns HTTP 响应
 */
async function handleFileAccess(filename: string): Promise<Response> {
  try {
    // 查找文件（在所有日期目录中搜索）
    const possiblePaths = [
      `${UPLOAD_DIR}/${filename}`,
      `${UPLOAD_DIR}/${generateDateSubdir()}/${filename}`,
    ];

    let filePath: string | null = null;
    for (const path of possiblePaths) {
      if (await storage.exists(path)) {
        filePath = path;
        break;
      }
    }

    if (!filePath) {
      return Response.json(
        { success: false, error: "文件不存在" },
        { status: 404 }
      );
    }

    // 读取文件
    const content = await storage.read(filePath);

    // 创建文件响应
    return createFileResponse(content, filename);
  } catch (error) {
    console.error("文件访问错误:", error);
    return Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

/**
 * 处理文件删除请求
 *
 * @param filename - 文件名
 * @returns HTTP 响应
 */
async function handleFileDelete(filename: string): Promise<Response> {
  try {
    const filePath = `${UPLOAD_DIR}/${filename}`;

    if (!await storage.exists(filePath)) {
      return Response.json(
        { success: false, error: "文件不存在" },
        { status: 404 }
      );
    }

    await storage.delete(filePath);

    return Response.json({ success: true, message: "文件已删除" });
  } catch (error) {
    console.error("删除错误:", error);
    return Response.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}

// ============================================================================
// 路由处理
// ============================================================================

/**
 * 主请求处理器
 *
 * @param request - HTTP 请求
 * @returns HTTP 响应
 */
async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const method = request.method;
  const path = url.pathname;

  // CORS 头
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Filename",
  };

  // 处理 OPTIONS 预检请求
  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  let response: Response;

  // 路由
  if (path === "/upload" && method === "POST") {
    // FormData 上传
    response = await handleUpload(request);
  } else if (path === "/upload/raw" && method === "POST") {
    // 原始字节上传
    response = await handleRawUpload(request);
  } else if (path.startsWith("/files/") && method === "GET") {
    // 文件访问
    const filename = decodeURIComponent(path.slice(7));
    response = await handleFileAccess(filename);
  } else if (path.startsWith("/files/") && method === "DELETE") {
    // 文件删除
    const filename = decodeURIComponent(path.slice(7));
    response = await handleFileDelete(filename);
  } else if (path === "/health") {
    // 健康检查
    response = Response.json({ status: "ok", timestamp: Date.now() });
  } else {
    // 404
    response = Response.json(
      { error: "Not Found", path },
      { status: 404 }
    );
  }

  // 添加 CORS 头
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }

  return response;
}

// ============================================================================
// 启动服务器
// ============================================================================

console.log(`\n文件上传服务器启动中...`);
console.log(`监听端口: ${PORT}`);
console.log(`\nAPI 接口:`);
console.log(`  POST   /upload      - FormData 文件上传`);
console.log(`  POST   /upload/raw  - 原始字节上传 (需要 X-Filename 头)`);
console.log(`  GET    /files/:name - 访问文件`);
console.log(`  DELETE /files/:name - 删除文件`);
console.log(`  GET    /health      - 健康检查`);
console.log(`\n服务器已启动: http://localhost:${PORT}\n`);

Deno.serve({ port: PORT }, handler);
