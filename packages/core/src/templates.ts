import { Eta } from 'eta';
import { MfeflowError, messageOf } from './errors';

export type TemplateData = Record<string, unknown>;

const eta = new Eta({ autoEscape: false, autoTrim: false, useWith: false });

/**
 * Renders an eta template with `it` bound to `data`. Eta compiles templates to
 * JavaScript, so this is for features that ship with mfeflow or live in the
 * user's own `features/` folder. Never pass it content fetched from a registry.
 */
export function renderTemplate(source: string, data: TemplateData, name = 'template'): string {
  try {
    return eta.renderString(source, data);
  } catch (error) {
    throw new MfeflowError('E209', `${name}: ${messageOf(error)}`, { cause: error });
  }
}

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;

function lookup(data: TemplateData, dotted: string): unknown {
  let value: unknown = data;
  for (const part of dotted.split('.')) {
    if (typeof value !== 'object' || value === null || !(part in value)) return undefined;
    value = Reflect.get(value, part);
  }
  return value;
}

/**
 * Replaces `{{name}}` and `{{a.b}}` with values from `data`. Nothing is
 * evaluated, so it is safe for content from third-party registries. An unknown
 * name is an error rather than an empty string.
 */
export function substitute(source: string, data: TemplateData, name = 'template'): string {
  return source.replace(PLACEHOLDER, (_match, key: string) => {
    const value = lookup(data, key);
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new MfeflowError('E209', `${name}: {{${key}}} has no value`);
    }
    return String(value);
  });
}
