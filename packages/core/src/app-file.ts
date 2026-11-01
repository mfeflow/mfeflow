import path from 'node:path';
import { MfeflowError } from './errors';
import { readIfExists, realFs, type FsOps } from './fs';

/** The ownership file in each app's folder. */
export const APP_FILE = 'mfeflow.app.json';

/** The name the app file had before 0.6. Still read, with a notice. */
export const LEGACY_APP_FILE = 'mfe.json';

export type AppFileName = typeof APP_FILE | typeof LEGACY_APP_FILE;

export interface AppFileText {
  /** Which of the two names was found. */
  name: AppFileName;
  text: string;
  /** True when only the old name exists. */
  legacy: boolean;
}

/**
 * The text of the app file in `dir`: `mfeflow.app.json`, else the old `mfe.json`, else undefined.
 * Throws E122 when both exist, because mfeflow cannot tell which one the team meant.
 */
export async function readAppFile(
  dir: string,
  ops: FsOps = realFs,
): Promise<AppFileText | undefined> {
  const [text, legacyText] = await Promise.all([
    readIfExists(ops, path.join(dir, APP_FILE)),
    readIfExists(ops, path.join(dir, LEGACY_APP_FILE)),
  ]);
  if (text !== undefined && legacyText !== undefined) {
    throw new MfeflowError('E122', `${dir} has both ${APP_FILE} and ${LEGACY_APP_FILE}`);
  }
  if (text !== undefined) return { name: APP_FILE, text, legacy: false };
  if (legacyText !== undefined) return { name: LEGACY_APP_FILE, text: legacyText, legacy: true };
  return undefined;
}

/** The one-line deprecation notice for apps that still use the old name, given their folders. */
export function legacyAppFileNotice(folders: readonly string[]): string {
  const files = folders.map((dir) => `${dir}/${LEGACY_APP_FILE}`).join(', ');
  return `Notice: ${LEGACY_APP_FILE} is now ${APP_FILE}. Rename ${files}; the old name still works for now.`;
}
