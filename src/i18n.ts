export type Lang = 'ar' | 'en'
export type T = { ar: string; en: string }

// The app re-renders from the root whenever the language changes, so a module-level
// current language is enough and lets plain helpers (formatters, labels) localize too.
let current: Lang = 'ar'
export const setLang = (l: Lang) => {
  current = l
}
export const getLang = () => current
export const isAr = () => current === 'ar'
/** Pick the string for the current language. */
export const L = (ar: string, en: string) => (current === 'ar' ? ar : en)
export const tx = (t: T) => t[current]
