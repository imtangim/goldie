/**
 * The languages the studio offers when adding a locale, with display names.
 * Pure data with no node imports, shared by the CLI and the studio. Codes are
 * BCP 47 tags, the form both App Store Connect and Play Console accept for
 * their listings (Apple drops the region for some: "ja", "ko").
 */
export type LocaleEntry = { code: string; name: string; native: string };

export const LOCALES: LocaleEntry[] = [
  { code: "en-US", name: "English (US)", native: "English" },
  { code: "en-GB", name: "English (UK)", native: "English" },
  { code: "en-AU", name: "English (Australia)", native: "English" },
  { code: "en-IN", name: "English (India)", native: "English" },
  { code: "ar-SA", name: "Arabic", native: "العربية" },
  { code: "bn-BD", name: "Bengali (Bangladesh)", native: "বাংলা" },
  { code: "bn-IN", name: "Bengali (India)", native: "বাংলা" },
  { code: "ca", name: "Catalan", native: "Català" },
  { code: "zh-Hans", name: "Chinese (Simplified)", native: "简体中文" },
  { code: "zh-Hant", name: "Chinese (Traditional)", native: "繁體中文" },
  { code: "hr", name: "Croatian", native: "Hrvatski" },
  { code: "cs", name: "Czech", native: "Čeština" },
  { code: "da", name: "Danish", native: "Dansk" },
  { code: "nl-NL", name: "Dutch", native: "Nederlands" },
  { code: "fil", name: "Filipino", native: "Filipino" },
  { code: "fi", name: "Finnish", native: "Suomi" },
  { code: "fr-FR", name: "French", native: "Français" },
  { code: "fr-CA", name: "French (Canada)", native: "Français (Canada)" },
  { code: "de-DE", name: "German", native: "Deutsch" },
  { code: "el", name: "Greek", native: "Ελληνικά" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી" },
  { code: "he", name: "Hebrew", native: "עברית" },
  { code: "hi", name: "Hindi", native: "हिन्दी" },
  { code: "hu", name: "Hungarian", native: "Magyar" },
  { code: "id", name: "Indonesian", native: "Bahasa Indonesia" },
  { code: "it", name: "Italian", native: "Italiano" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ko", name: "Korean", native: "한국어" },
  { code: "ms", name: "Malay", native: "Bahasa Melayu" },
  { code: "ml", name: "Malayalam", native: "മലയാളം" },
  { code: "mr", name: "Marathi", native: "मराठी" },
  { code: "ne", name: "Nepali", native: "नेपाली" },
  { code: "no", name: "Norwegian", native: "Norsk" },
  { code: "fa", name: "Persian", native: "فارسی" },
  { code: "pl", name: "Polish", native: "Polski" },
  { code: "pt-BR", name: "Portuguese (Brazil)", native: "Português (Brasil)" },
  { code: "pt-PT", name: "Portuguese (Portugal)", native: "Português" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "ro", name: "Romanian", native: "Română" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "sk", name: "Slovak", native: "Slovenčina" },
  { code: "es-ES", name: "Spanish (Spain)", native: "Español" },
  { code: "es-MX", name: "Spanish (Mexico)", native: "Español (México)" },
  { code: "sw", name: "Swahili", native: "Kiswahili" },
  { code: "sv", name: "Swedish", native: "Svenska" },
  { code: "ta", name: "Tamil", native: "தமிழ்" },
  { code: "te", name: "Telugu", native: "తెలుగు" },
  { code: "th", name: "Thai", native: "ไทย" },
  { code: "tr", name: "Turkish", native: "Türkçe" },
  { code: "uk", name: "Ukrainian", native: "Українська" },
  { code: "ur", name: "Urdu", native: "اردو" },
  { code: "vi", name: "Vietnamese", native: "Tiếng Việt" },
];

/** A readable name for a locale code, falling back to the code itself. */
export function localeName(code: string): string {
  return LOCALES.find((l) => l.code.toLowerCase() === code.toLowerCase())?.name ?? code;
}

/** Loose BCP 47 shape check: "bn", "bn-BD", "zh-Hans", "zh-Hant-TW". */
export function isLocaleCode(code: string): boolean {
  return /^[a-z]{2,3}(-[A-Za-z]{4})?(-([A-Z]{2}|\d{3}))?$/.test(code);
}
