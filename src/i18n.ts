/**
 * @module @dreamer/upload/i18n
 *
 * Upload 包 i18n：S3/COS/OSS 适配器、分片上传、服务端、扫描器等错误与提示的国际化。
 * 仅使用环境变量（LANGUAGE/LC_ALL/LANG）检测语言，不挂全局。
 */

import {
  createI18n,
  type I18n,
  type TranslationData,
  type TranslationParams,
} from "@dreamer/i18n";
import { getEnv } from "@dreamer/runtime-adapter";
import enUS from "./locales/en-US.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };

export type Locale = "en-US" | "zh-CN";
export const DEFAULT_LOCALE: Locale = "en-US";

const UPLOAD_LOCALES: Locale[] = ["en-US", "zh-CN"];
const LOCALE_DATA: Record<string, TranslationData> = {
  "en-US": enUS as TranslationData,
  "zh-CN": zhCN as TranslationData,
};

let uploadI18n: I18n | null = null;

/** 检测当前语言：仅使用环境变量 LANGUAGE > LC_ALL > LANG。 */
export function detectLocale(): Locale {
  const langEnv = getEnv("LANGUAGE") || getEnv("LC_ALL") || getEnv("LANG");
  if (!langEnv) return DEFAULT_LOCALE;
  const first = langEnv.split(/[:\s]/)[0]?.trim();
  if (!first) return DEFAULT_LOCALE;
  const match = first.match(/^([a-z]{2})[-_]([A-Z]{2})/i);
  if (match) {
    const normalized = `${match[1].toLowerCase()}-${
      match[2].toUpperCase()
    }` as Locale;
    if (UPLOAD_LOCALES.includes(normalized)) return normalized;
  }
  const primary = first.substring(0, 2).toLowerCase();
  if (primary === "zh") return "zh-CN";
  if (primary === "en") return "en-US";
  return DEFAULT_LOCALE;
}

/** 内部初始化，导入 i18n 时自动执行，不导出 */
function initUploadI18n(): void {
  if (uploadI18n) return;
  const i18n = createI18n({
    defaultLocale: DEFAULT_LOCALE,
    fallbackBehavior: "default",
    locales: [...UPLOAD_LOCALES],
    translations: LOCALE_DATA as Record<string, TranslationData>,
  });
  i18n.setLocale(detectLocale());
  uploadI18n = i18n;
}

initUploadI18n();

export function setUploadLocale(lang: Locale): void {
  initUploadI18n();
  if (uploadI18n) uploadI18n.setLocale(lang);
}

export function $tr(
  key: string,
  params?: TranslationParams,
  lang?: Locale,
): string {
  if (!uploadI18n) initUploadI18n();
  if (!uploadI18n) return key;
  if (lang !== undefined) {
    const prev = uploadI18n.getLocale();
    uploadI18n.setLocale(lang);
    try {
      return uploadI18n.t(key, params);
    } finally {
      uploadI18n.setLocale(prev);
    }
  }
  return uploadI18n.t(key, params);
}
