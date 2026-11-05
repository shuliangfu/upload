/**
 * @fileoverview 常量定义
 *
 * 文件上传相关的常量
 */

/**
 * 默认禁止的扩展名（可执行文件）
 */
/**
 * 默认禁止的扩展名（可执行／脚本／网页／WebAssembly）。
 *
 * 含 js／html／svg／wasm：堵住「当图片上传」的 XSS／脚本绕过。
 * 应用若确需放行静态资源，请显式收窄 `forbiddenExtensions`／`forbiddenMimeTypes`。
 */
export const DEFAULT_FORBIDDEN_EXTENSIONS = [
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".scr",
  ".ps1",
  ".vbs",
  ".wsf",
  ".sh",
  ".bash",
  ".zsh",
  ".php",
  ".phtml",
  ".php3",
  ".php4",
  ".php5",
  ".phar",
  ".jsp",
  ".jspx",
  ".asp",
  ".aspx",
  ".asa",
  ".cer",
  ".cgi",
  ".pl",
  ".py",
  ".rb",
  ".dll",
  ".so",
  ".dylib",
  ".wasm",
  ".js",
  ".mjs",
  ".cjs",
  ".jsx",
  ".ts",
  ".tsx",
  ".html",
  ".htm",
  ".shtml",
  ".xhtml",
  ".svg",
  ".svgz",
  ".htaccess",
  ".htpasswd",
  ".elf",
  ".apk",
  ".ipa",
  ".deb",
  ".rpm",
];

/**
 * 默认禁止的 MIME（与扩展名黑名单对齐；不信客户端 Content-Type 时仍作兜底）。
 */
export const DEFAULT_FORBIDDEN_MIME_TYPES = [
  "application/x-executable",
  "application/x-msdownload",
  "application/x-msdos-program",
  "application/x-mach-binary",
  "application/x-sharedlib",
  "application/x-elf",
  "application/wasm",
  "application/javascript",
  "text/javascript",
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/x-httpd-php",
  "text/x-php",
  "application/java-archive",
];

/**
 * 危险 ACL：默认拒绝，除非适配器显式 allowDangerousAcl。
 * 意图：防止误把桶对象设成任何人可写。
 */
export const DANGEROUS_ACLS = ["public-read-write"] as const;

/**
 * 常见 MIME 类型映射
 */
export const MIME_TYPES: Record<string, string> = {
  // 图片
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".tif": "image/tiff",
  // 视频
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".ogv": "video/ogg",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".wmv": "video/x-ms-wmv",
  ".flv": "video/x-flv",
  ".mkv": "video/x-matroska",
  // 音频
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".wma": "audio/x-ms-wma",
  // 文档
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".rtf": "application/rtf",
  // 压缩文件
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".tar": "application/x-tar",
  ".gz": "application/gzip",
  // 代码
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".md": "text/markdown",
  // 字体
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
};
