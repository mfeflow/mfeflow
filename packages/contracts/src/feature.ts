import { Checker, isObj, isSafeRelativePath, type Issue, type Obj } from './validate';
import { ROUTE } from './mfe-manifest';

/** The built-in transform ops. A public, versioned API (decision 0005). */
export const TRANSFORM_OPS = [
  'add-import',
  'wrap-provider',
  'add-shared',
  'add-boot-step',
  'add-env-key',
  'add-route',
  'add-workflow-step',
] as const;

export type TransformOpName = (typeof TRANSFORM_OPS)[number];

/** Where a feature part lands: the project root, the shell, every remote, or one app. */
export type FeatureTarget = string;

export type PromptValue = string | boolean;

/**
 * Applies a part only when every entry holds. A plain name is one of the feature's own options and
 * must have this value, for example `{ "validator": "zod" }`. `feature:<name>` asks whether that
 * feature is installed (or being added in the same command), for example `{ "feature:env-t3": true }`.
 */
export type FeatureCondition = Record<string, PromptValue>;

/** The validators `add-env-key` can write a schema for. */
export type EnvValidator = 'zod' | 'valibot' | 'arktype';

export interface FeaturePrompt {
  name: string;
  type: 'boolean' | 'string' | 'select';
  message?: string;
  default?: PromptValue;
  choices?: string[];
}

export interface FeatureFile {
  /** Destination, relative to the target. */
  to: string;
  target?: FeatureTarget;
  when?: FeatureCondition;
  /** Source file inside a local feature folder. Remote features cannot use it. */
  from?: string;
  /** Inline content. The only source a remote feature may use. */
  content?: string;
  /** Render with eta (local features) or `{{option}}` substitution (remote features). */
  template?: boolean;
}

export interface FeatureDependency {
  name: string;
  range: string;
  dev?: boolean;
  target?: FeatureTarget;
  when?: FeatureCondition;
}

export interface FeatureScript {
  name: string;
  command: string;
  target?: FeatureTarget;
  when?: FeatureCondition;
}

export type Literal = string | number | boolean | null;

interface TransformBase {
  /** File to edit, relative to the target. */
  file: string;
  target?: FeatureTarget;
  when?: FeatureCondition;
}

export interface AddImportOp extends TransformBase {
  op: 'add-import';
  from: string;
  named?: string[];
  default?: string;
  namespace?: string;
  typeOnly?: boolean;
}

export interface WrapProviderOp extends TransformBase {
  op: 'wrap-provider';
  component: string;
  from: string;
  props?: Record<string, Literal>;
  /** Import `component` as the default export of `from`. Default: a named import. */
  defaultImport?: boolean;
  /** The component to wrap the output of. Defaults to `Providers`. */
  function?: string;
}

export interface AddSharedOp extends TransformBase {
  op: 'add-shared';
  name: string;
  /** Name of the array holding the singletons. Defaults to `singletons`. */
  list?: string;
}

export interface AddBootStepOp extends TransformBase {
  op: 'add-boot-step';
  call: string;
  from: string;
  args?: Literal[];
  await?: boolean;
  /** Import `call` as the default export of `from`. Default: a named import. */
  defaultImport?: boolean;
  /** Insert before the step calling this function. Default: before the render. */
  before?: string;
  after?: string;
  function?: string;
}

/**
 * Adds a typed env key (decision 0020). `file` is the TypeScript file holding
 * the schema: `env.ts` for `server`, `src/config/schema.ts` for `runtime`.
 */
export interface AddEnvKeyOp extends TransformBase {
  op: 'add-env-key';
  key: string;
  scope: 'server' | 'runtime';
  /**
   * The schema as source text, for example `z.string().url()`. A map gives one per validator; the
   * one matching the validator the schema file imports is used.
   */
  schema: string | Partial<Record<EnvValidator, string>>;
  /** Placeholder written to `.env.example` (a list is joined with commas) or the runtime config files. Default: empty string. */
  value?: Literal | string[];
  /** The schema object's variable name for `runtime`. Defaults to `runtimeConfigSchema`. */
  object?: string;
  /** `server`: the dotenv example file to add a line to. Defaults to `.env.example`. */
  example?: string;
  /** `runtime`: the `runtime-config.<env>.json` files to add the key to. */
  configFiles?: string[];
}

export interface AddRouteOp extends TransformBase {
  op: 'add-route';
  path: string;
  component: string;
  from: string;
  /** Import `component` as the default export of `from`. Default: a named import. */
  defaultImport?: boolean;
  /** Name of the routes array. Defaults to `routes`. */
  routes?: string;
}

export interface WorkflowStep {
  name: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, Literal>;
  env?: Record<string, string>;
  if?: string;
}

export interface AddWorkflowStepOp extends TransformBase {
  op: 'add-workflow-step';
  job: string;
  step: WorkflowStep;
  /** Insert after the step with this name. Default: at the end. */
  after?: string;
}

export type TransformOp =
  | AddImportOp
  | WrapProviderOp
  | AddSharedOp
  | AddBootStepOp
  | AddEnvKeyOp
  | AddRouteOp
  | AddWorkflowStepOp;

/** First-party only. Declared here so `upgrade` can read it; never run for third parties. */
export interface FeatureMigration {
  from: string;
  to: string;
  module: string;
}

/** `feature.json`: one installable feature, declarative. */
export interface FeatureManifest {
  $schema?: string;
  name: string;
  version: string;
  description?: string;
  prompts?: FeaturePrompt[];
  requires?: string[];
  conflicts?: string[];
  files?: FeatureFile[];
  dependencies?: FeatureDependency[];
  scripts?: FeatureScript[];
  transforms?: TransformOp[];
  migrations?: FeatureMigration[];
}

/** Prefix of a `when` key that tests whether a feature is installed. */
export const FEATURE_CONDITION = 'feature:';

export const FEATURE_NAME = /^(@[a-z0-9-]+\/)?[a-z][a-z0-9-]*$/;
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TARGET = /^(root|shell|remotes|(app:)?[a-z][a-z0-9_]*)$/;
const PACKAGE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

function isTransformOp(op: string): op is TransformOpName {
  return TRANSFORM_OPS.some((name) => name === op);
}

function isLiteral(value: unknown): value is Literal {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function checkTarget(c: Checker, obj: Obj, at: string): void {
  c.string(obj, 'target', at, {
    required: false,
    pattern: TARGET,
    hint: 'must be root, shell, remotes, an app name or app:<name>',
  });
}

function checkLiteralMap(c: Checker, value: unknown, at: string): void {
  if (value === undefined) return;
  if (!isObj(value)) return c.add(at, 'must be an object');
  for (const [k, v] of Object.entries(value)) {
    if (!isLiteral(v)) c.add(`${at}.${k}`, 'must be a string, number, boolean or null');
  }
}

function checkWhen(c: Checker, obj: Obj, at: string): void {
  const when = obj.when;
  if (when === undefined) return;
  if (!isObj(when) || Object.keys(when).length === 0)
    return c.add(`${at}.when`, 'must be an object of option names and values');
  for (const [name, value] of Object.entries(when)) {
    const feature = name.startsWith(FEATURE_CONDITION) ? name.slice(FEATURE_CONDITION.length) : '';
    if (feature !== '') {
      if (!FEATURE_NAME.test(feature))
        c.add(`${at}.when`, `"${name}" must name a feature, like feature:env-t3`);
      if (typeof value !== 'boolean') c.add(`${at}.when.${name}`, 'must be true or false');
      continue;
    }
    if (!IDENT.test(name)) c.add(`${at}.when`, `"${name}" must be a JavaScript identifier`);
    if (typeof value !== 'string' && typeof value !== 'boolean')
      c.add(`${at}.when.${name}`, 'must be a string or boolean');
  }
}

function checkPath(c: Checker, obj: Obj, key: string, at: string): void {
  const value = c.string(obj, key, at);
  if (value !== undefined && !isSafeRelativePath(value))
    c.add(`${at}.${key}`, 'must be a relative path with forward slashes and no ".."');
}

const VALIDATORS: readonly EnvValidator[] = ['zod', 'valibot', 'arktype'];

function checkSchema(c: Checker, t: Obj, at: string): void {
  if (!isObj(t.schema)) {
    c.string(t, 'schema', at);
    return;
  }
  const entries = Object.entries(t.schema);
  if (entries.length === 0) c.add(`${at}.schema`, 'needs at least one validator');
  for (const [validator, text] of entries) {
    if (!VALIDATORS.some((v) => v === validator))
      c.add(`${at}.schema`, `"${validator}" must be one of ${VALIDATORS.join(', ')}`);
    else if (typeof text !== 'string') c.add(`${at}.schema.${validator}`, 'must be text');
  }
}

function checkTransform(c: Checker, t: unknown, at: string): void {
  if (!isObj(t)) return c.add(at, 'must be an object');
  const op = c.string(t, 'op', at);
  if (op === undefined) return;
  if (!isTransformOp(op)) {
    c.add(`${at}.op`, `unknown op "${op}"; built-in ops: ${TRANSFORM_OPS.join(', ')}`);
    return;
  }
  checkPath(c, t, 'file', at);
  checkTarget(c, t, at);
  checkWhen(c, t, at);
  if (t.defaultImport !== undefined && typeof t.defaultImport !== 'boolean')
    c.add(`${at}.defaultImport`, 'must be true or false');
  if (t.typeOnly !== undefined && typeof t.typeOnly !== 'boolean')
    c.add(`${at}.typeOnly`, 'must be true or false');
  if (t.await !== undefined && typeof t.await !== 'boolean')
    c.add(`${at}.await`, 'must be true or false');
  const ident = (key: string, required = true) =>
    c.string(t, key, at, { required, pattern: IDENT, hint: 'must be a JavaScript identifier' });
  switch (op) {
    case 'add-import': {
      c.string(t, 'from', at);
      c.stringArray(t, 'named', at, { required: false, pattern: IDENT });
      ident('default', false);
      ident('namespace', false);
      if (!t.named && !t.default && !t.namespace && t.typeOnly !== undefined)
        c.add(at, 'typeOnly needs named, default or namespace');
      break;
    }
    case 'wrap-provider':
      ident('component');
      c.string(t, 'from', at);
      ident('function', false);
      checkLiteralMap(c, t.props, `${at}.props`);
      break;
    case 'add-shared':
      c.string(t, 'name', at, { pattern: PACKAGE, hint: 'must be an npm package name' });
      ident('list', false);
      break;
    case 'add-boot-step':
      ident('call');
      c.string(t, 'from', at);
      ident('function', false);
      c.string(t, 'before', at, { required: false, pattern: IDENT });
      c.string(t, 'after', at, { required: false, pattern: IDENT });
      if (t.before !== undefined && t.after !== undefined)
        c.add(at, 'use before or after, not both');
      if (t.args !== undefined) {
        if (!Array.isArray(t.args)) c.add(`${at}.args`, 'must be an array');
        else
          t.args.forEach((a: unknown, i) => {
            if (!isLiteral(a))
              c.add(`${at}.args[${String(i)}]`, 'must be a string, number, boolean or null');
          });
      }
      break;
    case 'add-env-key': {
      c.string(t, 'key', at, { pattern: /^[A-Za-z_][A-Za-z0-9_]*$/, hint: 'must be a plain key' });
      const scope = c.string(t, 'scope', at);
      if (scope !== undefined && scope !== 'server' && scope !== 'runtime')
        c.add(`${at}.scope`, 'must be server or runtime');
      checkSchema(c, t, at);
      ident('object', false);
      if (t.example !== undefined) checkPath(c, t, 'example', at);
      if (t.configFiles !== undefined) {
        for (const f of c.stringArray(t, 'configFiles', at)) {
          if (!isSafeRelativePath(f))
            c.add(`${at}.configFiles`, `"${f}" must be a relative path with no ".."`);
        }
      }
      if (
        t.value !== undefined &&
        !isLiteral(t.value) &&
        !(Array.isArray(t.value) && t.value.every((v: unknown) => typeof v === 'string'))
      )
        c.add(`${at}.value`, 'must be a string, number, boolean, null or a list of strings');
      break;
    }
    case 'add-route':
      c.string(t, 'path', at, { pattern: ROUTE, hint: 'must be a route path' });
      ident('component');
      c.string(t, 'from', at);
      ident('routes', false);
      break;
    case 'add-workflow-step': {
      c.string(t, 'job', at, { pattern: /^[A-Za-z_][A-Za-z0-9_-]*$/, hint: 'must be a job id' });
      c.string(t, 'after', at, { required: false });
      const step = c.object(t, 'step', at);
      if (step) {
        c.string(step, 'name', `${at}.step`);
        for (const key of ['id', 'uses', 'run', 'if']) {
          c.string(step, key, `${at}.step`, { required: false });
        }
        checkLiteralMap(c, step.with, `${at}.step.with`);
        checkLiteralMap(c, step.env, `${at}.step.env`);
        if (!step.uses && !step.run) c.add(`${at}.step`, 'needs uses or run');
      }
      break;
    }
  }
}

function eachObject(
  c: Checker,
  value: Obj,
  key: string,
  check: (item: Obj, at: string) => void,
): void {
  const list = value[key];
  if (list === undefined) return;
  if (!Array.isArray(list)) return c.add(key, 'must be an array');
  list.forEach((item: unknown, i) => {
    const at = `${key}[${String(i)}]`;
    if (!isObj(item)) c.add(at, 'must be an object');
    else check(item, at);
  });
}

export function validateFeatureManifest(value: unknown): Issue[] {
  const c = new Checker();
  if (!isObj(value)) {
    c.add('', 'must be an object');
    return c.issues;
  }
  c.string(value, 'name', '', {
    pattern: FEATURE_NAME,
    hint: 'feature names look like "analytics-gtm" or "@someone/feature"',
  });
  c.string(value, 'version', '');
  c.string(value, 'description', '', { required: false });
  c.stringArray(value, 'requires', '', { required: false, pattern: FEATURE_NAME });
  c.stringArray(value, 'conflicts', '', { required: false, pattern: FEATURE_NAME });
  eachObject(c, value, 'prompts', (p, at) => {
    c.string(p, 'name', at, { pattern: IDENT, hint: 'must be a JavaScript identifier' });
    const type = c.string(p, 'type', at);
    if (type !== undefined && !['boolean', 'string', 'select'].includes(type))
      c.add(`${at}.type`, 'must be boolean, string or select');
    c.string(p, 'message', at, { required: false });
    if (p.default !== undefined && typeof p.default !== 'string' && typeof p.default !== 'boolean')
      c.add(`${at}.default`, 'must be a string or boolean');
    const choices = c.stringArray(p, 'choices', at, { required: type === 'select' });
    if (type === 'select' && typeof p.default === 'string' && !choices.includes(p.default))
      c.add(`${at}.default`, 'must be one of the choices');
  });
  eachObject(c, value, 'files', (f, at) => {
    checkPath(c, f, 'to', at);
    checkTarget(c, f, at);
    checkWhen(c, f, at);
    c.string(f, 'from', at, { required: false });
    c.string(f, 'content', at, { required: false });
    if (typeof f.from === 'string' && !isSafeRelativePath(f.from))
      c.add(`${at}.from`, 'must be a relative path with forward slashes and no ".."');
    if ((f.from === undefined) === (f.content === undefined))
      c.add(at, 'needs exactly one of from or content');
  });
  eachObject(c, value, 'dependencies', (d, at) => {
    c.string(d, 'name', at, { pattern: PACKAGE, hint: 'must be an npm package name' });
    c.string(d, 'range', at);
    checkTarget(c, d, at);
    checkWhen(c, d, at);
  });
  eachObject(c, value, 'scripts', (s, at) => {
    c.string(s, 'name', at, { pattern: /^[A-Za-z0-9:_.-]+$/, hint: 'must be a script name' });
    c.string(s, 'command', at);
    checkTarget(c, s, at);
    checkWhen(c, s, at);
  });
  eachObject(c, value, 'transforms', (t, at) => {
    checkTransform(c, t, at);
  });
  eachObject(c, value, 'migrations', (m, at) => {
    c.string(m, 'from', at);
    c.string(m, 'to', at);
    checkPath(c, m, 'module', at);
  });
  return c.issues;
}

export function isFeatureManifest(value: unknown): value is FeatureManifest {
  return validateFeatureManifest(value).length === 0;
}
