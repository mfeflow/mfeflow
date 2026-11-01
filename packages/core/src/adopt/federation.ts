import type { Node, ObjectExpression } from '@babel/types';
import {
  entriesOf,
  evaluate,
  fail,
  ok,
  resolveNode,
  type Entry,
  type Result,
  type Scope,
  type Value,
} from './evaluate';
import type { DetectedRemote, DetectedShared } from './types';

/** What the federation options say, minus the parts that could not be read. */
export interface FederationOptions {
  name?: string;
  remotes: Record<string, DetectedRemote>;
  exposes: Record<string, string>;
  shared: Record<string, DetectedShared>;
  /** Whether the options expose anything, counting entries that could not be read. */
  exposing: boolean;
}

/** Records a part that was not read: `field` is a dotted path, `reason` plain words. */
export type Report = (field: string, reason: string) => void;

/** `shared.react`, or `shared['react-dom']` when the key is not a plain name. */
export const fieldOf = (base: string, key: string): string =>
  /^[A-Za-z_$][\w$]*$/.test(key) ? `${base}.${key}` : `${base}['${key}']`;

const isRecord = (value: Value): value is Record<string, Value> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `name@https://…/mf-manifest.json` or a bare URL, split into its parts. */
export function parseRemote(value: string): Result<DetectedRemote> {
  if (value.startsWith('promise ')) return fail('is loaded by inline code (promise …)');
  const match = /^([^@/:\s]+)@(.+)$/.exec(value);
  const entry = match?.[2] ?? value;
  if (!entry.includes('/')) return fail(`has no URL ("${value}")`);
  const type = /\.json([?#]|$)/.test(entry) ? 'manifest' : 'script';
  return ok(match?.[1] ? { name: match[1], entry, type } : { entry, type });
}

/** Resolves `value` to an object literal, or reports why under `field`. */
function objectAt(value: Node, scope: Scope, field: string, report: Report): Entry[] | undefined {
  const target = resolveNode(value, scope);
  if (!target.ok) {
    report(field, target.reason);
    return undefined;
  }
  if (target.value.type !== 'ObjectExpression') {
    const evaluated = evaluate(target.value, scope);
    report(field, evaluated.ok ? 'is not an object' : evaluated.reason);
    return undefined;
  }
  const { entries, problems } = entriesOf(target.value, scope);
  for (const problem of problems) {
    report(problem.key ? fieldOf(field, problem.key) : field, problem.reason);
  }
  return entries;
}

function readRemotes(value: Node, scope: Scope, report: Report): Record<string, DetectedRemote> {
  const remotes: Record<string, DetectedRemote> = {};
  for (const { key, value: node } of objectAt(value, scope, 'remotes', report) ?? []) {
    const field = fieldOf('remotes', key);
    const evaluated = evaluate(node, scope);
    if (!evaluated.ok) {
      report(field, evaluated.reason);
      continue;
    }
    const raw = evaluated.value;
    const text = isRecord(raw) ? raw['external'] : raw;
    if (typeof text !== 'string') {
      report(field, isRecord(raw) ? 'has no string external' : 'is not a string');
      continue;
    }
    const remote = parseRemote(text);
    if (remote.ok) remotes[key] = remote.value;
    else report(field, remote.reason);
  }
  return remotes;
}

function readExposes(value: Node, scope: Scope, report: Report): Record<string, string> {
  const exposes: Record<string, string> = {};
  const target = resolveNode(value, scope);
  if (target.ok && target.value.type === 'ArrayExpression') {
    const evaluated = evaluate(target.value, scope);
    if (!evaluated.ok) report('exposes', evaluated.reason);
    else if (!Array.isArray(evaluated.value)) report('exposes', 'is not a list');
    else {
      for (const item of evaluated.value) {
        if (typeof item === 'string') exposes[item] = item;
        else report('exposes', 'is an array with items that are not strings');
      }
    }
    return exposes;
  }
  for (const { key, value: node } of objectAt(value, scope, 'exposes', report) ?? []) {
    const field = fieldOf('exposes', key);
    const evaluated = evaluate(node, scope);
    if (!evaluated.ok) {
      report(field, evaluated.reason);
      continue;
    }
    const raw = evaluated.value;
    const path = isRecord(raw) ? raw['import'] : raw;
    if (typeof path === 'string') exposes[key] = path;
    else report(field, 'is not a module path');
  }
  return exposes;
}

const NOT_CARRIED = 'is set in the config but adopt does not carry it over';
/** Shared options adopt drops; `eager` and `strictVersion` only when they are not plainly false. */
const NOT_CARRIED_SHARED = new Set(['eager', 'strictVersion', 'import']);
/** Top-level options adopt drops. */
const NOT_CARRIED_OPTIONS = new Set(['filename', 'shareStrategy', 'runtimePlugins']);

function readSharedEntry(
  key: string,
  node: Node,
  scope: Scope,
  report: Report,
): DetectedShared | undefined {
  const field = fieldOf('shared', key);
  const target = resolveNode(node, scope);
  if (!target.ok) {
    report(field, target.reason);
    return undefined;
  }
  if (target.value.type !== 'ObjectExpression') {
    const evaluated = evaluate(target.value, scope);
    if (!evaluated.ok) report(field, evaluated.reason);
    else if (typeof evaluated.value === 'string') return { requiredVersion: evaluated.value };
    else report(field, 'is not a version range or an options object');
    return undefined;
  }
  const shared: DetectedShared = {};
  const { entries, problems } = entriesOf(target.value, scope);
  for (const problem of problems) {
    report(problem.key ? fieldOf(field, problem.key) : field, problem.reason);
  }
  for (const entry of entries) {
    const at = fieldOf(field, entry.key);
    if (NOT_CARRIED_SHARED.has(entry.key)) {
      const evaluated = evaluate(entry.value, scope);
      const plainlyOff = entry.key !== 'import' && evaluated.ok && evaluated.value === false;
      if (!plainlyOff) report(at, NOT_CARRIED);
      continue;
    }
    if (entry.key !== 'singleton' && entry.key !== 'requiredVersion') continue;
    const evaluated = evaluate(entry.value, scope);
    if (!evaluated.ok) {
      report(at, evaluated.reason);
    } else if (entry.key === 'singleton' && typeof evaluated.value === 'boolean') {
      shared.singleton = evaluated.value;
    } else if (
      entry.key === 'requiredVersion' &&
      (typeof evaluated.value === 'string' || evaluated.value === false)
    ) {
      shared.requiredVersion = evaluated.value;
    } else {
      report(at, entry.key === 'singleton' ? 'is not true or false' : 'is not a version range');
    }
  }
  return shared;
}

function readShared(value: Node, scope: Scope, report: Report): Record<string, DetectedShared> {
  const shared: Record<string, DetectedShared> = {};
  const target = resolveNode(value, scope);
  if (target.ok && target.value.type === 'ArrayExpression') {
    for (const [index, element] of target.value.elements.entries()) {
      const evaluated = evaluate(element, scope);
      if (evaluated.ok && typeof evaluated.value === 'string') shared[evaluated.value] = {};
      else
        report(
          `shared[${String(index)}]`,
          evaluated.ok ? 'is not a package name' : evaluated.reason,
        );
    }
    return shared;
  }
  for (const { key, value: node } of objectAt(value, scope, 'shared', report) ?? []) {
    const entry = readSharedEntry(key, node, scope, report);
    if (entry) shared[key] = entry;
  }
  return shared;
}

/** Reads the fields adopt needs out of a federation options object literal. */
export function readFederationOptions(
  options: ObjectExpression,
  scope: Scope,
  report: Report,
): FederationOptions {
  const result: FederationOptions = { remotes: {}, exposes: {}, shared: {}, exposing: false };
  const { entries, problems } = entriesOf(options, scope);
  for (const problem of problems) report(problem.key ?? 'options', problem.reason);
  for (const { key, value } of entries) {
    switch (key) {
      case 'name': {
        const evaluated = evaluate(value, scope);
        if (evaluated.ok && typeof evaluated.value === 'string') result.name = evaluated.value;
        else report('name', evaluated.ok ? 'is not a string' : evaluated.reason);
        break;
      }
      case 'remotes':
        result.remotes = readRemotes(value, scope, report);
        break;
      case 'exposes': {
        let unread = false;
        result.exposes = readExposes(value, scope, (field, reason) => {
          unread = true;
          report(field, reason);
        });
        result.exposing = unread || Object.keys(result.exposes).length > 0;
        break;
      }
      case 'shared':
        result.shared = readShared(value, scope, report);
        break;
      default:
        if (NOT_CARRIED_OPTIONS.has(key)) report(key, NOT_CARRIED);
        break;
    }
  }
  return result;
}
