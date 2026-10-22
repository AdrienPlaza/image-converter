/**
 * i18n maison (JSON plats, FR/EN). Pas de `_locales` : le choix de langue est
 * un réglage applicatif (auto / français / anglais), appliqué au DOM via
 * `data-i18n*` et aux messages dynamiques via `t()`.
 */
import en from './en.json';
import fr from './fr.json';

export type Locale = 'fr' | 'en';
type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = {
  fr: fr as Dictionary,
  en: en as Dictionary,
};

let locale: Locale = 'fr';

/** Résout « auto » avec la langue de Chrome, sinon l'anglais. */
export function resolveLocale(preference: 'auto' | Locale): Locale {
  if (preference === 'fr' || preference === 'en') return preference;
  const uiLanguage =
    (typeof chrome !== 'undefined' && chrome.i18n?.getUILanguage?.()) ||
    (typeof navigator !== 'undefined' ? navigator.language : '') ||
    'fr';
  return uiLanguage.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

export function setLocale(next: Locale): void {
  locale = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

export function getLocale(): Locale {
  return locale;
}

/** Traduit une clé, avec interpolation `{variable}`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const template = dictionaries[locale][key] ?? dictionaries.en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}

/** Traduit avec pluriel : `key.one` / `key.other`. */
export function tn(
  key: string,
  count: number,
  vars?: Record<string, string | number>,
): string {
  const plural = locale === 'fr' ? count > 1 : count !== 1;
  return t(`${key}.${plural ? 'other' : 'one'}`, { count, ...vars });
}

export function hasTranslation(key: string): boolean {
  return key in dictionaries[locale] || key in dictionaries.en;
}

/** Applique les traductions aux éléments `data-i18n*`. */
export function applyTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n;
    if (key) element.textContent = t(key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((element) => {
    const key = element.dataset.i18nAriaLabel;
    if (key) element.setAttribute('aria-label', t(key));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((element) => {
    const key = element.dataset.i18nTitle;
    if (key) element.title = t(key);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((element) => {
    const key = element.dataset.i18nPlaceholder;
    if (key) element.placeholder = t(key);
  });
}

interface Localizable {
  code: string;
  params?: Record<string, string | number>;
  message?: string;
}

export function localizeError(error: Localizable): string {
  const key = `errors.${error.code}`;
  const text = hasTranslation(key) ? t(key, error.params) : t('errors.unknown');
  if (error.code === 'unknown' && error.message && error.message !== 'unknown') {
    return `${text} (${error.message})`;
  }
  return text;
}

export function localizeWarning(warning: Localizable): string {
  const key = `warnings.${warning.code}`;
  return hasTranslation(key) ? t(key, warning.params) : t('preview.warningsTitle');
}
