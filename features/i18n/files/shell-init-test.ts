import { getI18n, getLanguages } from '@mfeflow/i18n';
import { resetPlatform } from '@mfeflow/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { loadShellMessages } from './config';
import { initShellI18n } from './init';

afterEach(resetPlatform);

describe('initShellI18n', () => {
  it('starts the page instance with the shell languages', async () => {
    await initShellI18n();
    expect(getLanguages().map((l) => l.code)).toEqual(['en', 'ar']);
    expect(getI18n().t('shell:language')).toBe('Language');
  });

  it('sets lang and dir when the language changes', async () => {
    await initShellI18n();
    await getI18n().changeLanguage('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('loadShellMessages', () => {
  it('gives the messages of the language asked for', async () => {
    expect(await loadShellMessages('ar')).toEqual({ language: 'اللغة' });
  });

  it('falls back to the default language for one with no messages', async () => {
    expect(await loadShellMessages('fr')).toEqual({ language: 'Language' });
  });
});
