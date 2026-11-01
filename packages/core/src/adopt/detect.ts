import path from 'node:path';
import {
  isCallExpression,
  isIdentifier,
  isMemberExpression,
  isNewExpression,
  isNode,
  isObjectProperty,
  type CallExpression,
  type File,
  type NewExpression,
  type Node,
  type ObjectExpression,
} from '@babel/types';
import { messageOf } from '../errors';
import type { ReadFile } from '../plan';
import { findAll, parseSource, SKIP_KEYS } from '../transforms/ast';
import {
  entriesOf,
  evaluate,
  fail,
  ok,
  reasonFor,
  scopeOf,
  unwrap,
  type Result,
  type Scope,
} from './evaluate';
import { guardedDisk, isInside, type Refusal } from './disk';
import { readFederationOptions } from './federation';
import type {
  BuildTool,
  DetectedApp,
  DetectFederationOptions,
  FederationReport,
  NotAdopted,
} from './types';
import { eachInSequence, findAppDirs } from './workspace';

/** Config file extensions, in the order a bundler would pick them. */
const EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const BUILD_TOOLS: BuildTool[] = ['rsbuild', 'rspack', 'webpack'];
const FEDERATION_CONFIG = 'module-federation.config';
/** How many files deep the options object is followed through relative imports. */
const MAX_IMPORT_HOPS = 3;

interface Parsed {
  ast: File;
  scope: Scope;
}

interface Context {
  root: string;
  read: ReadFile;
  dir: string;
  notAdopted: NotAdopted[];
}

const relative = (root: string, file: string): string =>
  path.relative(root, file).split(path.sep).join('/') || '.';

function report(ctx: Context, file: string, field: string, reason: string): void {
  ctx.notAdopted.push({ dir: ctx.dir, file: relative(ctx.root, file), field, reason });
}

async function firstExisting(
  read: ReadFile,
  candidates: string[],
): Promise<{ file: string; source: string } | undefined> {
  const sources = await Promise.all(candidates.map((file) => read(file)));
  const index = sources.findIndex((s) => s !== undefined);
  const source = sources[index];
  const file = candidates[index];
  return source === undefined || file === undefined ? undefined : { file, source };
}

function load(ctx: Context, file: string, source: string): Parsed | undefined {
  try {
    const ast = parseSource(source, file);
    return { ast, scope: scopeOf(ast, file) };
  } catch {
    report(ctx, file, 'file', 'could not be parsed');
    return undefined;
  }
}

/** Local names that stand for `canonical`: itself, or an import or require of it under another name. */
function namesFor(scope: Scope, canonical: string): Set<string> {
  const names = new Set([canonical]);
  for (const [local, binding] of scope.bindings) {
    if (binding.kind === 'import' && binding.imported === canonical) names.add(local);
  }
  return names;
}

/** Every name declared by a pattern: `a`, `{ a, b: [c] }`, `...rest`. */
function patternNames(node: Node | null | undefined, out: Set<string>): void {
  if (!node) return;
  if (isIdentifier(node)) out.add(node.name);
  else if (node.type === 'ObjectPattern') {
    for (const prop of node.properties) {
      patternNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
    }
  } else if (node.type === 'ArrayPattern') {
    for (const element of node.elements) patternNames(element, out);
  } else if (node.type === 'RestElement') patternNames(node.argument, out);
  else if (node.type === 'AssignmentPattern') patternNames(node.left, out);
}

const isFunction = (n: Node): boolean =>
  n.type === 'FunctionDeclaration' ||
  n.type === 'FunctionExpression' ||
  n.type === 'ArrowFunctionExpression' ||
  n.type === 'ObjectMethod' ||
  n.type === 'ClassMethod';

const isLocalScope = (n: Node): boolean =>
  isFunction(n) ||
  n.type === 'BlockStatement' ||
  n.type === 'CatchClause' ||
  n.type === 'ForStatement' ||
  n.type === 'ForInStatement' ||
  n.type === 'ForOfStatement' ||
  n.type === 'SwitchStatement';

/** Every name declared anywhere inside `scope` (deliberately generous: a false hit only means "not read"). */
function declaredInside(scope: Node): Set<string> {
  const names = new Set<string>();
  if ('params' in scope) for (const param of scope.params) patternNames(param, names);
  if (scope.type === 'CatchClause') patternNames(scope.param, names);
  for (const node of findAll(
    scope,
    (n) =>
      n.type === 'VariableDeclarator' ||
      n.type === 'FunctionDeclaration' ||
      n.type === 'ClassDeclaration',
  )) {
    if (node.type === 'VariableDeclarator') patternNames(node.id, names);
    else if ('id' in node) patternNames(node.id, names);
  }
  return names;
}

interface FederationCall {
  node: CallExpression | NewExpression;
  /** Names declared in the functions and blocks around the call. */
  shadowed: ReadonlySet<string>;
}

/**
 * `pluginModuleFederation(…)`, `mf.pluginModuleFederation(…)`, and
 * `new ModuleFederationPlugin(…)` / `new x.container.ModuleFederationPlugin(…)`.
 * A call whose name is redeclared in an enclosing function or block is not
 * the plugin.
 */
function federationCalls(ast: File, scope: Scope): FederationCall[] {
  const plugin = namesFor(scope, 'pluginModuleFederation');
  const webpack = namesFor(scope, 'ModuleFederationPlugin');
  const found: FederationCall[] = [];
  const matches = (n: Node, shadowed: ReadonlySet<string>): boolean => {
    if (isCallExpression(n)) {
      const callee = n.callee;
      if (isIdentifier(callee)) return plugin.has(callee.name) && !shadowed.has(callee.name);
      return (
        isMemberExpression(callee) &&
        isIdentifier(callee.property, { name: 'pluginModuleFederation' })
      );
    }
    if (!isNewExpression(n)) return false;
    const callee = n.callee;
    if (isIdentifier(callee)) return webpack.has(callee.name) && !shadowed.has(callee.name);
    return (
      isMemberExpression(callee) &&
      isIdentifier(callee.property, { name: 'ModuleFederationPlugin' })
    );
  };
  const visit = (value: unknown, shadowed: ReadonlySet<string>): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, shadowed);
      return;
    }
    if (!isNode(value)) return;
    if (matches(value, shadowed) && (isCallExpression(value) || isNewExpression(value))) {
      found.push({ node: value, shadowed });
    }
    const inner =
      value.type !== 'Program' && isLocalScope(value)
        ? new Set([...shadowed, ...declaredInside(value)])
        : shadowed;
    for (const [key, child] of Object.entries(value)) {
      if (!SKIP_KEYS.has(key)) visit(child, inner);
    }
  };
  visit(ast.program, new Set());
  return found;
}

/** The file's scope as seen from inside the call: top-level names the call's surroundings redeclare are no longer trusted. */
function scopeAt(scope: Scope, shadowed: ReadonlySet<string>): Scope {
  if (![...shadowed].some((name) => scope.bindings.has(name))) return scope;
  const bindings = new Map(scope.bindings);
  for (const name of shadowed) {
    if (bindings.has(name)) {
      bindings.set(name, {
        kind: 'other',
        what: 'declared again inside a function around the call',
      });
    }
  }
  return { ...scope, bindings };
}

const isRelative = (source: string): boolean =>
  source === '.' || source === '..' || source.startsWith('./') || source.startsWith('../');

function candidatesFor(target: string): string[] {
  const ext = path.extname(target);
  if (EXTENSIONS.includes(ext)) {
    // TypeScript ESM imports `./x.js` for `./x.ts`.
    const stem = target.slice(0, -ext.length);
    return [target, ...(ext === '.js' ? [`${stem}.ts`] : ext === '.mjs' ? [`${stem}.mts`] : [])];
  }
  return [
    ...EXTENSIONS.map((e) => `${target}${e}`),
    ...EXTENSIONS.map((e) => path.join(target, `index${e}`)),
  ];
}

interface Options {
  object: ObjectExpression;
  scope: Scope;
}

/**
 * Follows the plugin's argument to an object literal: through same-file
 * consts, `createModuleFederationConfig({…})`, and relative imports (read as
 * source, never run).
 */
async function resolveOptions(
  ctx: Context,
  node: Node | null | undefined,
  scope: Scope,
  hops = 0,
  seen: ReadonlySet<string> = new Set(),
): Promise<Result<Options>> {
  const n = unwrap(node);
  if (!n) return fail('are missing');
  if (n.type === 'ObjectExpression') return ok({ object: n, scope });
  if (isCallExpression(n)) {
    const wrapper = namesFor(scope, 'createModuleFederationConfig');
    if (isIdentifier(n.callee) && wrapper.has(n.callee.name)) {
      return resolveOptions(ctx, n.arguments[0], scope, hops, seen);
    }
    return fail(reasonFor(n));
  }
  if (!isIdentifier(n)) {
    const evaluated = evaluate(n, scope);
    return fail(evaluated.ok ? 'are not an object' : evaluated.reason);
  }
  const binding = scope.bindings.get(n.name);
  if (binding?.kind === 'const' && !seen.has(n.name)) {
    if (scope.mutated.has(n.name)) {
      return fail(`refers to ${n.name}, which is changed later in the file`);
    }
    return resolveOptions(ctx, binding.init, scope, hops, new Set([...seen, n.name]));
  }
  if (binding?.kind !== 'import') {
    const evaluated = evaluate(n, scope);
    return fail(evaluated.ok ? 'are not an object' : evaluated.reason);
  }
  if (!isRelative(binding.source)) {
    return fail(`are imported from a package (${n.name} from '${binding.source}')`);
  }
  if ((binding.depth ?? 0) > 1) {
    return fail(`are read from deep inside an import ('${binding.source}')`);
  }
  if (hops >= MAX_IMPORT_HOPS)
    return fail(`are imported through more than ${String(MAX_IMPORT_HOPS)} files`);
  const target = path.resolve(path.dirname(scope.file), binding.source);
  if (!isInside(ctx.root, target)) {
    return fail(`are imported from outside the project ('${binding.source}')`);
  }
  if (path.relative(ctx.root, target).split(path.sep).includes('node_modules')) {
    return fail(`are imported from node_modules ('${binding.source}')`);
  }
  const found = await firstExisting(ctx.read, candidatesFor(target));
  if (!found) return fail(`are imported from '${binding.source}', which was not found`);
  const imported = load(ctx, found.file, found.source)?.scope;
  if (!imported) return fail(`are imported from '${binding.source}', which could not be parsed`);
  const exported = binding.imported === '*' ? undefined : imported.exports.get(binding.imported);
  if (!exported) {
    return fail(
      binding.imported === 'default'
        ? `are imported from '${binding.source}', which has no default export`
        : `are imported from '${binding.source}', which has no export ${binding.imported}`,
    );
  }
  const local = imported.exportedFrom.get(binding.imported);
  if (local && imported.mutated.has(local)) {
    return fail(
      `are imported from '${binding.source}', where ${local} is changed later in the file`,
    );
  }
  return resolveOptions(ctx, exported, imported, hops + 1);
}

/** The literal dev server port: `server.port` for rsbuild, `devServer.port` for rspack and webpack. */
function readPort(ctx: Context, ast: Node, scope: Scope, tool: BuildTool): number | undefined {
  const key = tool === 'rsbuild' ? 'server' : 'devServer';
  const ports: Node[] = [];
  for (const prop of findAll(ast, (n) => isObjectProperty(n))) {
    if (!isObjectProperty(prop) || prop.computed || !isIdentifier(prop.key, { name: key }))
      continue;
    const value = unwrap(prop.value);
    if (value?.type !== 'ObjectExpression') continue;
    const port = entriesOf(value, scope).entries.findLast((e) => e.key === 'port');
    if (port) ports.push(port.value);
  }
  const [first, ...others] = ports;
  if (!first) return undefined;
  if (others.length > 0) {
    report(ctx, scope.file, 'port', 'is set in more than one place');
    return undefined;
  }
  const evaluated = evaluate(first, scope);
  if (evaluated.ok && typeof evaluated.value === 'number') return evaluated.value;
  report(ctx, scope.file, 'port', evaluated.ok ? 'is not a number' : evaluated.reason);
  return undefined;
}

async function packageName(read: ReadFile, dir: string): Promise<string | undefined> {
  const text = await read(path.join(dir, 'package.json'));
  if (text === undefined) return undefined;
  try {
    const pkg: unknown = JSON.parse(text);
    return typeof pkg === 'object' && pkg !== null && 'name' in pkg && typeof pkg.name === 'string'
      ? pkg.name
      : undefined;
  } catch {
    return undefined;
  }
}

async function detectApp(ctx: Context): Promise<DetectedApp | undefined> {
  const abs = path.join(ctx.root, ...ctx.dir.split('/'));
  const builds = BUILD_TOOLS.flatMap((tool) =>
    EXTENSIONS.map((ext) => ({ tool, file: path.join(abs, `${tool}.config${ext}`) })),
  );
  const [build, federation] = await Promise.all([
    firstExisting(
      ctx.read,
      builds.map((b) => b.file),
    ),
    firstExisting(
      ctx.read,
      EXTENSIONS.map((ext) => path.join(abs, `${FEDERATION_CONFIG}${ext}`)),
    ),
  ]);
  if (!build) {
    if (federation) {
      report(
        ctx,
        federation.file,
        'buildTool',
        'has no rsbuild, rspack or webpack config next to it',
      );
    }
    return undefined;
  }
  const tool = builds.find((b) => b.file === build.file)?.tool ?? 'rsbuild';
  const parsed = load(ctx, build.file, build.source);
  if (!parsed) return undefined;
  const { ast, scope } = parsed;
  const calls = federationCalls(ast, scope);
  if (calls.length > 1) {
    report(
      ctx,
      build.file,
      'options',
      `has ${String(calls.length)} Module Federation plugins in one config, so none of them is read`,
    );
    return undefined;
  }
  let options: Result<Options>;
  const [call] = calls;
  if (call) {
    options = await resolveOptions(ctx, call.node.arguments[0], scopeAt(scope, call.shadowed));
  } else if (federation) {
    const mfScope = load(ctx, federation.file, federation.source)?.scope;
    if (!mfScope) return undefined;
    options = await resolveOptions(ctx, mfScope.exports.get('default'), mfScope);
  } else {
    return undefined;
  }
  if (!options.ok) {
    report(ctx, build.file, 'options', options.reason);
    return undefined;
  }
  const optionsFile = options.value.scope.file;
  const read = readFederationOptions(options.value.object, options.value.scope, (field, reason) => {
    report(ctx, optionsFile, field, reason);
  });
  const port = readPort(ctx, ast, scope, tool);
  const pkgName = await packageName(ctx.read, abs);
  return {
    dir: ctx.dir,
    ...(read.name === undefined ? {} : { name: read.name }),
    ...(pkgName === undefined ? {} : { packageName: pkgName }),
    role: read.exposing ? 'remote' : 'shell',
    buildTool: tool,
    configFile: relative(ctx.root, build.file),
    ...(optionsFile === build.file ? {} : { federationFile: relative(ctx.root, optionsFile) }),
    remotes: read.remotes,
    exposes: read.exposes,
    shared: read.shared,
    ...(port === undefined ? {} : { port }),
  };
}

/**
 * Works out the Module Federation setup of an existing project by reading
 * its config files as source. Config files are parsed, never imported or run:
 * only literal values (and `const` names in the same file) are trusted, and
 * everything else is listed in `notAdopted` with the reason.
 *
 * Apps are the folder itself plus each workspace package from
 * `pnpm-workspace.yaml` or package.json `workspaces`.
 */
export async function detectFederation(
  dir: string,
  options: DetectFederationOptions = {},
): Promise<FederationReport> {
  const root = path.resolve(dir);
  const refused: Refusal[] = [];
  const disk = guardedDisk(root, refused);
  const read = options.read ?? disk.read;
  const listDirs = options.listDirs ?? disk.listDirs;
  const notAdopted: NotAdopted[] = [];
  const problems: { file: string; reason: string }[] = [];
  const dirs = await findAppDirs(root, read, listDirs, problems);
  for (const problem of problems) {
    notAdopted.push({ dir: '.', file: problem.file, field: 'workspaces', reason: problem.reason });
  }
  const apps: DetectedApp[] = [];
  await eachInSequence(dirs, async (appDir) => {
    const ctx: Context = { root, read, dir: appDir, notAdopted: [] };
    try {
      const app = await detectApp(ctx);
      if (app) apps.push(app);
    } catch (error) {
      report(
        ctx,
        path.join(root, ...appDir.split('/')),
        'file',
        `could not be read (${messageOf(error)})`,
      );
    }
    notAdopted.push(...ctx.notAdopted);
  });
  for (const refusal of refused) {
    notAdopted.push({ dir: '.', file: refusal.file, field: 'file', reason: refusal.reason });
  }
  return { apps, notAdopted };
}
