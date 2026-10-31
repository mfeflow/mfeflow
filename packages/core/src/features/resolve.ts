import { isSafeRelativePath, type FeatureFile, type FeatureManifest } from '@mfeflow/contracts';
import { MfeflowError } from '../errors.js';
import { joinPosix } from '../paths.js';
import { inOrder } from '../sequence.js';
import type { PlanBuilder } from '../plan.js';
import type { MfeflowProject } from '../project.js';
import { renderTemplate, substitute, type TemplateData } from '../templates.js';
import { applyTransform } from '../transforms/index.js';
import { envKeyFiles } from '../transforms/add-env-key.js';
import type { LoadedFeature } from './load.js';
import { assertPlainScript } from './policy.js';
import { assertWritable as assertSafeTarget, isProtectedPath } from './write-policy.js';

export interface ResolveInput {
  feature: LoadedFeature;
  project: MfeflowProject;
  builder: PlanBuilder;
  /** Answers to the feature's prompts. Missing ones take the prompt's default. */
  options?: Record<string, unknown>;
  /** Features added in the same command, which count as installed for `requires` and `conflicts`. */
  alsoAdding?: readonly string[];
}

interface Place {
  name: string;
  dir: string;
  kind: 'root' | 'shell' | 'remote';
}

function placesFor(target: string | undefined, project: MfeflowProject): Place[] {
  const apps = Object.entries(project.apps).map(([name, app]) => {
    if (!isSafeRelativePath(app.path)) throw new MfeflowError('E105', `app ${name}: "${app.path}"`);
    return { name, dir: app.path, kind: app.kind } satisfies Place;
  });
  const where = target ?? 'root';
  if (where === 'root') return [{ name: 'root', dir: '', kind: 'root' }];
  if (where === 'shell') return apps.filter((a) => a.kind === 'shell');
  if (where === 'remotes') return apps.filter((a) => a.kind === 'remote');
  const app = apps.find((a) => a.name === where);
  if (!app)
    throw new MfeflowError(
      'E208',
      `the feature targets app "${where}", which is not in mfeflow.json`,
    );
  return [app];
}

/** Checks `value` against the prompts and fills in defaults. */
export function resolveOptions(
  manifest: FeatureManifest,
  given: Record<string, unknown> = {},
): Record<string, string | boolean> {
  const prompts = manifest.prompts ?? [];
  for (const key of Object.keys(given)) {
    if (!prompts.some((p) => p.name === key)) {
      throw new MfeflowError('E214', `${manifest.name} has no option "${key}"`);
    }
  }
  const out: Record<string, string | boolean> = {};
  for (const prompt of prompts) {
    const value: unknown =
      given[prompt.name] ?? prompt.default ?? (prompt.type === 'boolean' ? false : undefined);
    if (value === undefined) throw new MfeflowError('E214', `${prompt.name} is required`);
    if (prompt.type === 'boolean') {
      if (typeof value !== 'boolean') {
        throw new MfeflowError('E214', `${prompt.name} must be true or false`);
      }
      out[prompt.name] = value;
      continue;
    }
    if (typeof value !== 'string') throw new MfeflowError('E214', `${prompt.name} must be text`);
    if (prompt.type === 'select' && !prompt.choices?.includes(value)) {
      throw new MfeflowError(
        'E214',
        `${prompt.name} must be one of ${(prompt.choices ?? []).join(', ')}`,
      );
    }
    out[prompt.name] = value;
  }
  return out;
}

function assertWritable(file: string, trusted: boolean): void {
  if (!isSafeRelativePath(file)) throw new MfeflowError('E105', `"${file}"`);
  assertSafeTarget(file);
  if (!trusted && isProtectedPath(file)) {
    throw new MfeflowError('E203', `"${file}" is a protected file`);
  }
}

async function contentOf(
  file: FeatureFile,
  feature: LoadedFeature,
  data: TemplateData,
): Promise<string> {
  const label = `${feature.manifest.name}:${file.to}`;
  let raw: string;
  if (file.content !== undefined) raw = file.content;
  else if (feature.readAsset && file.from !== undefined) raw = await feature.readAsset(file.from);
  else throw new MfeflowError('E202', `${label} has no content`);
  if (!file.template) return raw;
  return feature.trust === 'first-party'
    ? renderTemplate(raw, data, label)
    : substitute(raw, data, label);
}

/**
 * Turns a loaded feature into edits on the plan builder: files, dependencies,
 * scripts and transform ops. Nothing is written to disk and nothing is run.
 */
export async function resolveFeature(input: ResolveInput): Promise<void> {
  const { feature, project, builder } = input;
  const { manifest } = feature;
  const trusted = feature.trust === 'first-party';
  const present = new Set([...Object.keys(project.features), ...(input.alsoAdding ?? [])]);

  for (const other of manifest.conflicts ?? []) {
    if (present.has(other)) throw new MfeflowError('E205', `${manifest.name} and ${other}`);
  }
  for (const needed of manifest.requires ?? []) {
    if (!present.has(needed)) throw new MfeflowError('E206', `${manifest.name} needs ${needed}`);
  }
  const options = resolveOptions(manifest, input.options);

  const dataFor = (place: Place): TemplateData => ({
    scope: project.scope,
    topology: project.topology,
    packageManager: project.packageManager,
    options,
    feature: { name: manifest.name, version: manifest.version },
    app: { name: place.name, kind: place.kind, path: place.dir },
  });

  const steps: (() => Promise<void>)[] = [];

  for (const file of manifest.files ?? []) {
    for (const place of placesFor(file.target, project)) {
      const to = joinPosix(place.dir, file.to);
      assertWritable(to, trusted);
      steps.push(async () => builder.create(to, await contentOf(file, feature, dataFor(place))));
    }
  }

  for (const dep of manifest.dependencies ?? []) {
    for (const place of placesFor(dep.target, project)) {
      const pkg = joinPosix(place.dir, 'package.json');
      steps.push(() => builder.addDependency(pkg, dep.name, dep.range, dep.dev));
    }
  }

  for (const script of manifest.scripts ?? []) {
    for (const place of placesFor(script.target, project)) {
      const pkg = joinPosix(place.dir, 'package.json');
      steps.push(async () => {
        if (!trusted)
          assertPlainScript(script.name, await existingScripts(builder, pkg), manifest.name);
        await builder.addScript(pkg, script.name, script.command);
      });
    }
  }

  for (const transform of manifest.transforms ?? []) {
    for (const place of placesFor(transform.target, project)) {
      const files = transform.op === 'add-env-key' ? envKeyFiles(transform) : [transform.file];
      for (const rel of files) {
        const file = joinPosix(place.dir, rel);
        assertWritable(file, trusted);
        steps.push(() =>
          editFile(
            builder,
            file,
            (source) => applyTransform(source, file, transform),
            transform.op,
          ),
        );
      }
      if (transform.op === 'add-env-key') {
        builder.addEnvKey(joinPosix(place.dir, transform.file), transform.key);
      }
    }
  }

  await inOrder(steps, (step) => step());

  builder.addFeature({
    name: manifest.name,
    version: manifest.version,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  });
}

async function existingScripts(builder: PlanBuilder, pkgFile: string): Promise<string[]> {
  const text = await builder.content(pkgFile);
  if (text === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    const scripts: unknown =
      typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'scripts') : undefined;
    return typeof scripts === 'object' && scripts !== null ? Object.keys(scripts) : [];
  } catch {
    return [];
  }
}

/** Patches a file; a missing `.env*` example file is created instead, since it is optional. */
async function editFile(
  builder: PlanBuilder,
  file: string,
  edit: (source: string) => string,
  op: string,
): Promise<void> {
  const isExample = op === 'add-env-key' && /(^|\/)\.env[^/]*$/.test(file);
  if (isExample && !(await builder.exists(file))) {
    await builder.create(file, edit(''), false);
    return;
  }
  await builder.patch(file, edit);
}
