/**
 * @fileoverview 辅助函数
 *
 * 文件名处理、验证、哈希计算等工具函数
 */

import {
  DANGEROUS_ACLS,
  DEFAULT_FORBIDDEN_EXTENSIONS,
  DEFAULT_FORBIDDEN_MIME_TYPES,
  MIME_TYPES,
} from "./constants.ts";
import { resolve } from "@dreamer/runtime-adapter";
import type {
  FileValidationInput,
  FileValidationOptions,
  FileValidationResult,
} from "./types.ts";

// ============================================================================
// 文件名处理
// ============================================================================

/**
 * 获取文件扩展名
 *
 * @param filename - 文件名
 * @returns 扩展名（包含点号，小写）
 */
export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot > 0) {
    return filename.slice(lastDot).toLowerCase();
  }
  return "";
}

/**
 * 获取文件基本名（不含扩展名）
 *
 * @param filename - 文件名
 * @returns 基本名
 */
export function getBaseName(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot > 0) {
    return filename.slice(0, lastDot);
  }
  return filename;
}

/**
 * 获取 MIME 类型
 *
 * @param filename - 文件名或扩展名
 * @returns MIME 类型
 */
export function getMimeType(filename: string): string {
  const ext = filename.startsWith(".")
    ? filename.toLowerCase()
    : getFileExtension(filename);
  return MIME_TYPES[ext] || "application/octet-stream";
}

/**
 * 检查 MIME 类型是否匹配模式
 *
 * @param mimeType - MIME 类型
 * @param pattern - 匹配模式（支持通配符，如 "image/*"）
 * @returns 是否匹配
 */
export function matchMimeType(mimeType: string, pattern: string): boolean {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return mimeType.startsWith(prefix);
  }
  return mimeType === pattern;
}

/**
 * 生成唯一文件名
 *
 * @param originalName - 原始文件名
 * @param preserveExtension - 是否保留扩展名（默认 true）
 * @returns 唯一文件名
 */
export function generateFilename(
  originalName: string,
  preserveExtension = true,
): string {
  const uuid = crypto.randomUUID();
  if (preserveExtension) {
    const ext = getFileExtension(originalName);
    return uuid + ext;
  }
  return uuid;
}

/**
 * 生成带时间戳的文件名
 *
 * @param originalName - 原始文件名
 * @param preserveExtension - 是否保留扩展名（默认 true）
 * @returns 时间戳文件名
 */
export function generateTimestampFilename(
  originalName: string,
  preserveExtension = true,
): string {
  // 意图：时间戳前缀便于排序；必须先 sanitize，避免把路径分隔符／控制字符带进文件名。
  const safe = sanitizeFilename(originalName) || "file";
  const timestamp = Date.now();
  if (preserveExtension) {
    return `${timestamp}_${safe}`;
  }
  return `${timestamp}_${getBaseName(safe)}`;
}

/**
 * 清理文件名（移除不安全字符）
 *
 * @param filename - 原始文件名
 * @returns 清理后的文件名
 */
export function sanitizeFilename(filename: string): string {
  // NFKC：全角点／兼容字符归一；再剥 RTL／控制符／空字节截断面
  let s = filename.normalize("NFKC");
  // 空字节及 C0／C1 控制符（含截断绕过）
  // deno-lint-ignore no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  // RTL／LTR 嵌入与覆写（U+202A–U+202E、U+2066–U+2069）
  s = s.replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
  // 路径分隔与 Windows 非法字符
  s = s.replace(/[<>:"/\\|?*]/g, "");
  s = s.replace(/^\.+/, "");
  s = s.replace(/\s+/g, "_");
  return s.slice(0, 255);
}

/**
 * 为扩展名检查归一化文件名：NFKC、去 RTL、全角点→`.`、去空字节、小写。
 *
 * 为何与 sanitizeFilename 分开：sanitize 会删非法字符；本函数专供黑名单匹配，
 * 保留点分结构以便检出 `file.php\0.jpg` 经归一后变成 `file.php.jpg` 类攻击。
 */
export function normalizeFilenameForPolicy(filename: string): string {
  let s = filename.normalize("NFKC");
  // deno-lint-ignore no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
  s = s.replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
  // 各类「看起来像点」的字符 → ASCII 点
  s = s.replace(/[．｡。﹒]/g, ".");
  return s.toLowerCase();
}

// ============================================================================
// 扩展名安全
// ============================================================================

/**
 * 在文件名各段中查找禁止扩展名。
 *
 * 不变量：对 `a.php.jpg` 仍命中 `.php`（双扩展绕过）。
 * 边界：隐藏文件 `.env` 的首段为空，从第二段起检查。
 * 为何不只查最后一段：攻击者常用 `shell.php.png` 骗过只看末扩展名的校验。
 *
 * @param filename - 原始文件名
 * @param forbidden - 禁止扩展名列表（含点号）
 * @returns 命中的扩展名，未命中返回 null
 */
export function findForbiddenExtension(
  filename: string,
  forbidden: string[] = DEFAULT_FORBIDDEN_EXTENSIONS,
): string | null {
  const lower = normalizeFilenameForPolicy(filename);
  const parts = lower.split(".");
  for (let i = 1; i < parts.length; i++) {
    const cand = "." + parts[i];
    if (forbidden.includes(cand)) return cand;
  }
  return null;
}

// ============================================================================
// 文件验证
// ============================================================================

/**
 * 验证文件是否允许上传
 *
 * @param file - 文件信息
 * @param options - 验证选项
 * @returns 验证结果
 */
export function validateFile(
  file: FileValidationInput,
  options: FileValidationOptions = {},
): FileValidationResult {
  const { name: filename, type: mimeType, size: fileSize } = file;

  // 检查文件大小
  if (fileSize !== undefined && options.maxFileSize !== undefined) {
    if (fileSize > options.maxFileSize) {
      const maxSizeMB = (options.maxFileSize / (1024 * 1024)).toFixed(2);
      return {
        valid: false,
        error: `文件大小超过限制，最大允许 ${maxSizeMB} MB`,
      };
    }
  }

  // 检查禁止的扩展名（含双扩展：file.php.jpg）
  const forbiddenExts = options.forbiddenExtensions ||
    DEFAULT_FORBIDDEN_EXTENSIONS;
  const forbiddenHit = findForbiddenExtension(filename, forbiddenExts);
  if (forbiddenHit) {
    return { valid: false, error: `禁止上传 ${forbiddenHit} 类型的文件` };
  }

  const ext = getFileExtension(filename);

  // 检查允许的扩展名
  if (options.allowedExtensions && options.allowedExtensions.length > 0) {
    if (!options.allowedExtensions.includes(ext)) {
      return {
        valid: false,
        error: `只允许上传 ${options.allowedExtensions.join(", ")} 类型的文件`,
      };
    }
  }

  // 检查禁止的 MIME 类型（默认含 html／svg／js／可执行）
  const forbiddenMimes = options.forbiddenMimeTypes ??
    DEFAULT_FORBIDDEN_MIME_TYPES;
  if (forbiddenMimes.length > 0 && mimeType) {
    for (const forbidden of forbiddenMimes) {
      if (matchMimeType(mimeType, forbidden)) {
        return { valid: false, error: `禁止上传 ${mimeType} 类型的文件` };
      }
    }
  }

  // 检查允许的 MIME 类型
  if (options.allowedMimeTypes && options.allowedMimeTypes.length > 0) {
    let allowed = false;
    for (const allowedType of options.allowedMimeTypes) {
      if (matchMimeType(mimeType, allowedType)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) {
      return {
        valid: false,
        error: `只允许上传 ${options.allowedMimeTypes.join(", ")} 类型的文件`,
      };
    }
  }

  return { valid: true };
}

/**
 * 批量验证文件
 *
 * @param files - 文件列表
 * @param options - 验证选项
 * @param maxTotalSize - 总大小限制（可选）
 * @returns 验证结果
 */
export function validateFiles(
  files: FileValidationInput[],
  options: FileValidationOptions = {},
  maxTotalSize?: number,
): FileValidationResult {
  let totalSize = 0;

  for (const file of files) {
    const result = validateFile(file, options);
    if (!result.valid) {
      return result;
    }
    if (file.size !== undefined) {
      totalSize += file.size;
    }
  }

  if (maxTotalSize !== undefined && totalSize > maxTotalSize) {
    const maxSizeMB = (maxTotalSize / (1024 * 1024)).toFixed(2);
    return {
      valid: false,
      error: `总文件大小超过限制，最大允许 ${maxSizeMB} MB`,
    };
  }

  return { valid: true };
}

// ============================================================================
// 文件类型检测（Magic Bytes）
// ============================================================================

/**
 * 常见文件类型的 Magic Bytes 签名
 */
const MAGIC_BYTES: Array<{
  mimeType: string;
  extensions: string[];
  signature: number[];
  offset?: number;
  /** 第二段签名（如 RIFF 后的 WEBP/WAVE），避免 WebP/WAV 互相误判 */
  secondary?: { offset: number; bytes: number[] };
}> = [
  // 图片
  {
    mimeType: "image/jpeg",
    extensions: [".jpg", ".jpeg"],
    signature: [0xFF, 0xD8, 0xFF],
  },
  {
    mimeType: "image/png",
    extensions: [".png"],
    signature: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  },
  {
    mimeType: "image/gif",
    extensions: [".gif"],
    signature: [0x47, 0x49, 0x46, 0x38],
  },
  {
    mimeType: "image/webp",
    extensions: [".webp"],
    signature: [0x52, 0x49, 0x46, 0x46], // RIFF
    secondary: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
  },
  { mimeType: "image/bmp", extensions: [".bmp"], signature: [0x42, 0x4D] },
  {
    mimeType: "image/tiff",
    extensions: [".tiff", ".tif"],
    signature: [0x49, 0x49, 0x2A, 0x00],
  },
  {
    mimeType: "image/svg+xml",
    extensions: [".svg"],
    signature: [0x3C, 0x3F, 0x78, 0x6D, 0x6C],
  }, // <?xml
  {
    mimeType: "image/x-icon",
    extensions: [".ico"],
    signature: [0x00, 0x00, 0x01, 0x00],
  },
  // 压缩文件
  {
    mimeType: "application/zip",
    extensions: [".zip"],
    signature: [0x50, 0x4B, 0x03, 0x04],
  },
  {
    mimeType: "application/gzip",
    extensions: [".gz"],
    signature: [0x1F, 0x8B],
  },
  {
    mimeType: "application/x-rar-compressed",
    extensions: [".rar"],
    signature: [0x52, 0x61, 0x72, 0x21],
  },
  {
    mimeType: "application/x-7z-compressed",
    extensions: [".7z"],
    signature: [0x37, 0x7A, 0xBC, 0xAF],
  },
  {
    mimeType: "application/x-tar",
    extensions: [".tar"],
    signature: [0x75, 0x73, 0x74, 0x61, 0x72],
    offset: 257,
  },
  // 文档
  {
    mimeType: "application/pdf",
    extensions: [".pdf"],
    signature: [0x25, 0x50, 0x44, 0x46],
  }, // %PDF
  // 可执行文件（危险）
  {
    mimeType: "application/x-executable",
    extensions: [".exe"],
    signature: [0x4D, 0x5A],
  }, // MZ
  {
    mimeType: "application/x-mach-binary",
    extensions: [".macho"],
    signature: [0xCF, 0xFA, 0xED, 0xFE],
  },
  // 视频
  {
    mimeType: "video/mp4",
    extensions: [".mp4"],
    signature: [0x00, 0x00, 0x00],
    offset: 4,
  }, // ftyp at offset 4
  {
    mimeType: "video/webm",
    extensions: [".webm"],
    signature: [0x1A, 0x45, 0xDF, 0xA3],
  },
  // 音频
  { mimeType: "audio/mpeg", extensions: [".mp3"], signature: [0xFF, 0xFB] },
  {
    mimeType: "audio/wav",
    extensions: [".wav"],
    signature: [0x52, 0x49, 0x46, 0x46], // RIFF
    secondary: { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] }, // WAVE
  },
  {
    mimeType: "audio/ogg",
    extensions: [".ogg"],
    signature: [0x4F, 0x67, 0x67, 0x53],
  },
];

/**
 * 通过 Magic Bytes 检测文件真实类型
 *
 * @param content - 文件内容（至少前 300 字节）
 * @returns 检测到的 MIME 类型，未知返回 null
 *
 * @example
 * ```typescript
 * const buffer = await file.arrayBuffer();
 * const realType = detectMimeType(new Uint8Array(buffer));
 * if (realType !== file.type) {
 *   console.warn("文件类型与扩展名不匹配！");
 * }
 * ```
 */
export function detectMimeType(content: Uint8Array): string | null {
  for (const entry of MAGIC_BYTES) {
    const offset = entry.offset ?? 0;
    if (content.length < offset + entry.signature.length) continue;

    let match = true;
    for (let i = 0; i < entry.signature.length; i++) {
      if (content[offset + i] !== entry.signature[i]) {
        match = false;
        break;
      }
    }
    if (!match) continue;

    if (entry.secondary) {
      const s = entry.secondary;
      if (content.length < s.offset + s.bytes.length) continue;
      let sec = true;
      for (let i = 0; i < s.bytes.length; i++) {
        if (content[s.offset + i] !== s.bytes[i]) {
          sec = false;
          break;
        }
      }
      if (!sec) continue;
    }

    return entry.mimeType;
  }
  return null;
}

/**
 * 验证文件内容是否与声明的 MIME 类型匹配
 *
 * @param content - 文件内容
 * @param declaredMimeType - 声明的 MIME 类型
 * @returns 是否匹配
 */
export function validateMimeType(
  content: Uint8Array,
  declaredMimeType: string,
): { valid: boolean; detected?: string; error?: string } {
  const detected = detectMimeType(content);

  // 魔数检出危险可执行／Mach-O 一律拒（不信声明）
  if (
    detected === "application/x-executable" ||
    detected === "application/x-mach-binary"
  ) {
    return {
      valid: false,
      detected,
      error: "检测到可执行文件，禁止上传",
    };
  }

  // 声明本身在默认 MIME 黑名单
  for (const forbidden of DEFAULT_FORBIDDEN_MIME_TYPES) {
    if (matchMimeType(declaredMimeType, forbidden)) {
      return {
        valid: false,
        detected: detected ?? undefined,
        error: `禁止上传 ${declaredMimeType} 类型的文件`,
      };
    }
  }

  // 内容扫描：HTML／SVG／脚本嵌入（堵住「冒充 image/jpeg」）
  const payload = scanDangerousPayload(content);
  if (payload) {
    return {
      valid: false,
      detected: detected ?? payload,
      error: `检测到危险内容: ${payload}`,
    };
  }

  // 无法魔数识别：对「声称是图片／音视频」仍要求魔数命中，防纯文本冒充
  if (detected === null) {
    const prefix = declaredMimeType.split("/")[0] ?? "";
    if (prefix === "image" || prefix === "audio" || prefix === "video") {
      return {
        valid: false,
        error: `无法通过魔数验证 ${declaredMimeType}，拒绝上传`,
      };
    }
    return { valid: true };
  }

  // 检出类型在黑名单（如把 svg 魔数当图）
  for (const forbidden of DEFAULT_FORBIDDEN_MIME_TYPES) {
    if (matchMimeType(detected, forbidden)) {
      return {
        valid: false,
        detected,
        error: `检测到禁止类型 ${detected}`,
      };
    }
  }

  const declaredPrefix = declaredMimeType.split("/")[0];
  const detectedPrefix = detected.split("/")[0];

  if (declaredPrefix !== detectedPrefix) {
    return {
      valid: false,
      detected,
      error: `文件类型不匹配：声明 ${declaredMimeType}，实际检测 ${detected}`,
    };
  }

  return { valid: true, detected };
}

/**
 * 扫描内容中的危险载荷（无害启发式，非杀毒）。
 *
 * 覆盖：HTML／SVG／PHP／脚本头、GIF／PNG 后夹脚本的浅层 polyglot、PDF 内嵌 MZ。
 * 边界：只看前 8KiB + 全文件对短标记的抽样；不替代专业 AV。
 */
export function scanDangerousPayload(content: Uint8Array): string | null {
  if (content.length === 0) return null;
  const headLen = Math.min(content.length, 8192);
  const head = content.subarray(0, headLen);
  let text = "";
  for (let i = 0; i < head.length; i++) {
    text += String.fromCharCode(head[i]!);
  }
  const lower = text.toLowerCase();

  const isGif = content.length >= 6 &&
    content[0] === 0x47 && content[1] === 0x49 && content[2] === 0x46;
  const isPng = content.length >= 8 &&
    content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e &&
    content[3] === 0x47;
  const isPdf = content.length >= 5 &&
    content[0] === 0x25 && content[1] === 0x50 && content[2] === 0x44 &&
    content[3] === 0x46;

  // Polyglot 优先于泛 HTML：GIF／PNG 头后夹脚本
  if (
    (isGif || isPng) && (lower.includes("<script") || lower.includes("<?php"))
  ) {
    return "polyglot-script";
  }
  if (isPdf) {
    const scan = Math.min(content.length, 65536);
    for (let i = 4; i < scan - 1; i++) {
      if (content[i] === 0x4d && content[i + 1] === 0x5a) {
        return "polyglot-pdf-exe";
      }
    }
  }

  // SVG 先于泛 <script>（svg 内常含 script）
  if (lower.includes("<svg") || lower.includes("image/svg")) {
    return "image/svg+xml";
  }
  if (
    lower.includes("<!doctype html") || lower.includes("<html") ||
    lower.includes("<script")
  ) {
    return "text/html";
  }
  if (
    lower.includes("<?php") || lower.includes("<?= ") ||
    lower.includes("<%")
  ) {
    return "text/x-php";
  }
  return null;
}

export function validateContentExtensionConsistency(
  filename: string,
  content: Uint8Array,
  declaredMimeType?: string,
): { valid: boolean; error?: string; detected?: string } {
  const ext = getFileExtension(normalizeFilenameForPolicy(filename));
  const fromExt = ext ? MIME_TYPES[ext] : undefined;
  const magic = validateMimeType(
    content,
    declaredMimeType || fromExt || "application/octet-stream",
  );
  if (!magic.valid) return magic;

  if (fromExt && magic.detected) {
    // 主类型不同，或同为 image／audio／video 但具体 MIME 不同（png vs gif）均拒
    if (fromExt !== magic.detected) {
      const a = fromExt.split("/")[0];
      const b = magic.detected.split("/")[0];
      // application/octet-stream 等宽松类型仅比主类型
      const loose = fromExt === "application/octet-stream" ||
        magic.detected === "application/octet-stream";
      if (
        !loose && (a !== b || a === "image" || a === "audio" || a === "video")
      ) {
        return {
          valid: false,
          detected: magic.detected,
          error:
            `扩展名 ${ext}（${fromExt}）与内容类型 ${magic.detected} 不一致`,
        };
      }
      if (a !== b) {
        return {
          valid: false,
          detected: magic.detected,
          error: `扩展名 ${ext} 与内容类型 ${magic.detected} 不一致`,
        };
      }
    }
  }

  // 扩展名在黑名单（双扩展已在 findForbiddenExtension 覆盖；此处兜底）
  const hit = findForbiddenExtension(filename);
  if (hit) {
    return { valid: false, error: `禁止上传 ${hit} 类型的文件` };
  }

  return { valid: true, detected: magic.detected };
}

/**
 * 统一上传内容策略入口（Uploader／合并后二次校验共用）。
 */
export function validateUploadContent(
  filename: string,
  content: Uint8Array,
  declaredMimeType?: string,
): { valid: boolean; error?: string; detected?: string } {
  return validateContentExtensionConsistency(
    filename,
    content,
    declaredMimeType,
  );
}

/**
 * 脱敏错误信息：去掉绝对路径与过长内部键，避免 500／400 回显。
 */
export function redactErrorMessage(message: string): string {
  let m = message;
  // Unix / Windows 绝对路径
  m = m.replace(/(?:\/[\w.-]+)+/g, "[path]");
  m = m.replace(
    /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*/g,
    "[path]",
  );
  // 过长 key
  m = m.replace(/[a-f0-9-]{36}(?:\/[\w.-]+)*/gi, "[key]");
  if (m.length > 200) m = m.slice(0, 200) + "…";
  return m;
}

// ============================================================================
// 文件大小格式化
// ============================================================================

/**
 * 格式化文件大小
 *
 * @param bytes - 字节数
 * @param decimals - 小数位数（默认 2）
 * @returns 格式化后的大小字符串
 */
export function formatFileSize(bytes: number, decimals = 2): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + " " +
    sizes[i];
}

/**
 * 检查是否是图片文件
 */
export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/**
 * 检查是否是视频文件
 */
export function isVideo(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

/**
 * 检查是否是音频文件
 */
export function isAudio(mimeType: string): boolean {
  return mimeType.startsWith("audio/");
}

/**
 * 检查是否是文档文件
 */
export function isDocument(mimeType: string): boolean {
  const docTypes = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "text/plain",
    "text/csv",
    "text/markdown",
  ];
  return docTypes.some((type) => mimeType.startsWith(type));
}

/**
 * 检查是否是压缩文件
 */
export function isArchive(mimeType: string): boolean {
  const archiveTypes = [
    "application/zip",
    "application/x-rar-compressed",
    "application/vnd.rar",
    "application/x-7z-compressed",
    "application/x-tar",
    "application/gzip",
  ];
  return archiveTypes.includes(mimeType);
}

/**
 * 检查是否是隐藏文件
 */
export function isHiddenFile(filename: string): boolean {
  return filename.startsWith(".");
}

/**
 * 安全检查相对路径（防止目录遍历攻击）。
 *
 * 签名：`isPathSafe(relativePath, basePath)` —— 两个参数；旧文档写单参已纠正。
 * 不变量：含 `..`、绝对路径、空字节、反斜杠一律拒绝。
 * 真正落盘前请再调用 {@link resolveSafePath}（resolve 后 startsWith baseDir）。
 *
 * @param path - 相对路径（对象键／文件名段）
 * @param basePath - 基础目录（用于字符串级拼接校验）
 * @returns 路径是否安全
 */
export function isPathSafe(path: string, basePath: string): boolean {
  if (!path || path.trim() === "") return false;
  if (path.includes("..")) return false;
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false;
  if (path.includes("\0") || path.includes("\\")) return false;

  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (decoded.includes("..") || decoded.includes("\0")) return false;

  const normalizedPath = path.replace(/\/+/g, "/").replace(/^\.\//, "");
  if (!normalizedPath || normalizedPath.startsWith("/")) return false;
  const normalizedBase = basePath.replace(/\/+$/, "");
  const fullPath = `${normalizedBase}/${normalizedPath}`;
  if (!fullPath.startsWith(normalizedBase + "/")) return false;

  return true;
}

/** UUID v1–v5 形态（multipart uploadId／staging 目录名必须符合） */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 校验字符串是否为 UUID。
 *
 * @param id - 候选 ID
 */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * 清理对象键：去掉空段／`.`／`..`，并对每段 {@link sanitizeFilename}。
 *
 * 为何不只靠 isPathSafe：客户端可能传 `foo/./bar` 或脏字符，需归一化后再笼。
 *
 * @param key - 原始对象键
 * @returns 清理后的相对键；全空则返回空串
 */
export function sanitizeObjectKey(key: string): string {
  return key
    .split("/")
    .map((seg) => sanitizeFilename(seg))
    .filter((seg) => seg.length > 0 && seg !== "." && seg !== "..")
    .join("/");
}

/**
 * 在 baseDir 牢笼内 resolve 相对键；越界抛错。
 *
 * 不变量：返回值 === resolve(baseDir, key) 且必须以 resolve(baseDir) 为前缀
 * （目录边界用尾 `/`，避免 `/uploads` 匹配 `/uploads-evil`）。
 *
 * @param baseDir - 根目录
 * @param relativeKey - 相对键（不得绝对、不得含 `..`）
 * @returns 绝对安全路径
 */
function normalizePathSep(path: string): string {
  return path.replace(/\\/g, "/");
}

export function resolveSafePath(baseDir: string, relativeKey: string): string {
  if (!isPathSafe(relativeKey, baseDir)) {
    throw new Error(`Unsafe path rejected: ${relativeKey}`);
  }
  const resolvedBase = resolve(baseDir);
  const resolved = resolve(baseDir, relativeKey);
  // Windows may yield `\`; cage check must be separator-agnostic.
  const baseNorm = normalizePathSep(resolvedBase).replace(/\/+$/, "");
  const resolvedNorm = normalizePathSep(resolved);
  if (resolvedNorm !== baseNorm && !resolvedNorm.startsWith(baseNorm + "/")) {
    throw new Error(`Path escapes baseDir: ${relativeKey}`);
  }
  return resolved;
}

/**
 * 断言路径安全；失败抛错（供适配器／Uploader 统一接线）。
 */
export function assertPathSafe(baseDir: string, relativeKey: string): string {
  return resolveSafePath(baseDir, relativeKey);
}

/**
 * 拒绝危险 ACL，除非显式允许。
 *
 * @param acl - 请求的 ACL
 * @param allowDangerousAcl - 是否允许 public-read-write
 */
export function assertSafeAcl(
  acl: string | undefined,
  allowDangerousAcl = false,
): void {
  if (!acl) return;
  if (
    (DANGEROUS_ACLS as readonly string[]).includes(acl) && !allowDangerousAcl
  ) {
    throw new Error(
      `Dangerous ACL "${acl}" rejected; set allowDangerousAcl: true to override`,
    );
  }
}

/**
 * RFC 5987 Content-Disposition（filename + filename*）。
 *
 * 为何不单用 encodeURIComponent 包在 filename="..."：老客户端要 ASCII fallback，
 * 现代客户端读 filename*。
 *
 * @param filename - 展示文件名（会再 sanitize）
 * @param download - true → attachment，否则 inline
 */
export function buildContentDisposition(
  filename: string,
  download = false,
): string {
  const safe = sanitizeFilename(filename) || "download";
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safe).replace(/['()]/g, escape);
  const type = download ? "attachment" : "inline";
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * 薄配额守卫（内存计数）。
 *
 * 意图：补齐 README 曾宣称但未实现的「配额」能力；默认不强制接入，避免破坏现有用法。
 * 边界：进程内有效，不跨实例；生产应接外部配额源。
 */
export class QuotaGuard {
  private usedBytes: number;

  constructor(
    private readonly maxBytes: number,
    usedBytes = 0,
  ) {
    this.usedBytes = usedBytes;
  }

  /** 当前快照 */
  snapshot(): { usedBytes: number; maxBytes: number; remainingBytes: number } {
    return {
      usedBytes: this.usedBytes,
      maxBytes: this.maxBytes,
      remainingBytes: Math.max(0, this.maxBytes - this.usedBytes),
    };
  }

  /** 是否还能再接收 size 字节 */
  canAccept(size: number): boolean {
    return this.usedBytes + size <= this.maxBytes;
  }

  /** 预留；不足则抛错 */
  reserve(size: number): void {
    if (!this.canAccept(size)) {
      throw new Error(
        `Quota exceeded: need ${size}, remaining ${this.snapshot().remainingBytes}`,
      );
    }
    this.usedBytes += size;
  }

  /** 释放（删除文件后） */
  release(size: number): void {
    this.usedBytes = Math.max(0, this.usedBytes - size);
  }
}

// ============================================================================
// 文件哈希
// ============================================================================

/**
 * 计算文件内容的 SHA-256 哈希
 *
 * @param content - 文件内容
 * @returns 哈希值（十六进制字符串）
 */
export async function computeHash(content: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", content.slice());
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 计算文件的短哈希（用于 ETag 等）
 *
 * @param content - 文件内容
 * @returns 短哈希值
 */
export async function computeShortHash(content: Uint8Array): Promise<string> {
  const hash = await computeHash(content);
  return hash.slice(0, 16);
}

// ============================================================================
// 便捷函数
// ============================================================================

/**
 * 生成按日期分类的子目录
 *
 * @returns 日期格式的目录名（YYYY/MM/DD）
 */
export function generateDateSubdir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

/**
 * 生成按月份分类的子目录
 *
 * @returns 月份格式的目录名（YYYY-MM）
 */
export function generateMonthSubdir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * 从 URL 获取文件名
 */
export function getFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const segments = pathname.split("/");
    return segments[segments.length - 1] || "";
  } catch {
    const segments = url.split("/");
    return segments[segments.length - 1] || "";
  }
}

/**
 * 创建文件下载响应
 *
 * @param content - 文件内容
 * @param filename - 文件名
 * @param options - 响应选项
 * @returns Response 对象
 */
export function createFileResponse(
  content: Uint8Array,
  filename: string,
  options: {
    download?: boolean;
    mimeType?: string;
    maxAge?: number;
  } = {},
): Response {
  const mimeType = options.mimeType || getMimeType(filename);
  const disposition = buildContentDisposition(filename, !!options.download);

  const headers: Record<string, string> = {
    "Content-Type": mimeType,
    "Content-Disposition": disposition,
    "Content-Length": String(content.length),
  };

  if (options.maxAge !== undefined) {
    headers["Cache-Control"] = `public, max-age=${options.maxAge}`;
  }

  // 使用 slice() 确保类型兼容
  return new Response(new Blob([content.slice()]), { headers });
}
