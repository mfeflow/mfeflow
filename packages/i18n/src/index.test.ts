import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectLanguage,
  getI18n,
  getLanguages,
  initI18n,
  loadNamespace,
  resetI18nForTests,
} from './index.js';

const languages = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ar', label: 'العربية' },
];

const arabicMissing = (lng: string) =>
  lng === 'ar' ? Promise.reject(new Error('404')) : Promise.resolve({ hello: `hello-${lng}` });

afterEach(() => {
  resetI18nForTests();
  localStorage.clear();
  document.documentElement.removeAttribute('lang');
  document.documentElement.removeAttribute('dir');
});

describe('detectLanguage', () => {
  it('uses stored, then exact or base browser language, then the fallback', () => {
    const codes = ['en', 'hi', 'ar'];
    expect(detectLanguage(codes, 'hi', ['ar'], 'en')).toBe('hi');
    expect(detectLanguage(codes, 'xx', ['ar-EG'], 'en')).toBe('ar');
    expect(detectLanguage(codes, undefined, ['fr', 'hi'], 'en')).toBe('hi');
    expect(detectLanguage(codes, undefined, ['fr'], 'en')).toBe('en');
  });
});

describe('initI18n', () => {
  it('creates one instance and sets lang and dir on <html>', async () => {
    const i18n = await initI18n({ languages, defaultLanguage: 'en', detect: false });
    expect(getI18n()).toBe(i18n);
    expect(await initI18n({ languages, defaultLanguage: 'en' })).toBe(i18n);
    expect(getLanguages()).toEqual(languages);
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('switches to RTL for Arabic and persists the choice', async () => {
    const i18n = await initI18n({ languages, defaultLanguage: 'en', detect: false });
    await i18n.changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('shell:language')).toBe('"ar"');
  });

  it('restores the stored language', async () => {
    localStorage.setItem('shell:language', '"hi"');
    const i18n = await initI18n({ languages, defaultLanguage: 'en', detect: false });
    expect(i18n.language).toBe('hi');
  });

  it('rejects an unknown default and throws before init', async () => {
    expect(() => getI18n()).toThrow(/initI18n/);
    expect(getLanguages()).toEqual([]);
    await expect(initI18n({ languages, defaultLanguage: 'fr' })).rejects.toThrow(
      /Default language "fr"/,
    );
  });
});

describe('loadNamespace', () => {
  it('loads a namespace once per language, from objects or ES modules', async () => {
    const i18n = await initI18n({ languages, defaultLanguage: 'en', detect: false });
    const loader = vi.fn((lng: string) => Promise.resolve({ default: { hello: `hello-${lng}` } }));
    await loadNamespace(i18n, 'cart', loader);
    await loadNamespace(i18n, 'cart', loader);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(i18n.t('hello', { ns: 'cart' })).toBe('hello-en');
    await loadNamespace(i18n, 'catalog', () => Promise.resolve({ title: 'Catalog' }), 'hi');
    expect(i18n.getResource('hi', 'catalog', 'title')).toBe('Catalog');
  });

  it('falls back to the default language when a language fails to load', async () => {
    const i18n = await initI18n({ languages, defaultLanguage: 'en', detect: false });
    await loadNamespace(i18n, 'cart', arabicMissing, 'ar');
    expect(i18n.getResource('en', 'cart', 'hello')).toBe('hello-en');
  });

  it('rethrows when the default language itself fails, and rejects non-objects', async () => {
    const i18n = await initI18n({ languages, defaultLanguage: 'en', detect: false });
    await expect(
      loadNamespace(i18n, 'x', () => Promise.reject(new Error('down')), 'en'),
    ).rejects.toThrow('down');
    await expect(loadNamespace(i18n, 'y', () => Promise.resolve([]), 'en')).rejects.toThrow(
      /object of messages/,
    );
  });
});
