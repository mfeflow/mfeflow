import {
  isSafeRelativePath,
  type FeatureCondition,
  type FeatureFile,
  type FeatureManifest,
} from '@mfeflow/contracts';
import { MfeflowError } from '../errors';
import { joinPosix } from '../paths';
import { inOrder } from '../sequence';
import type { PlanBuilder } from '../plan';
import type { MfeflowProject } from '../project';
import { renderTemplate, substitute, type TemplateData } from '../templates';
import { addTurboEnv, applyTransform } from '../transforms';
import { envKeyFiles } from '../transforms/add-env-key';
import type { LoadedFeature } from './load';
import { assertPlainScript, assertThirdPartyTransform } from './policy';
import { sanitizeSchema } from './schema-policy';
import { assertThirdPartyPath, assertWritable as assertSafeTarget } from './write-policy';

export interface ResolveInput {
  feature: LoadedFeature;
  project: MfeflowProject;
  builder: PlanBuilder;
  /** Answers to the feature's prompts. Missing ones take the prompt's default. */
  options?: Record<string, unknown>;
  /** Features added in the same command, which count as installed for `requires` and `conflicts`. */
  alsoAdding?: readonly string[];
}

const TURBO_FILE = 'turbo.json';
/** `app:shell` is the app called shell, where plain `shell` is every shell. */
const EXACT_APP = 'app:';

interface Place {
  name: string;
  dir: string;
  kind: 'root' | 'shell' | 'remote';
  port?: number;
}

function placesFor(target: string | undefined, project: MfeflowProject): Place[] {
  const apps = Object.entries(project.apps).map(([name, app]) => {
    if (!isSafeRelativePath(app.path)) throw new MfeflowError('E105', `app ${name}: "${app.path}"`);
    const place: Place = { name, dir: app.path, kind: app.kind };
    if (app.port !== undefined) place.port = app.port;
    return place;
  });
  const where = target ?? 'root';
  if (where === 'root') return [{ name: 'root', dir: '', kind: 'root' }];
  if (where === 'shell') return apps.filter((a) => a.kind === 'shell');
  if (where === 'remotes') return apps.filter((a) => a.kind === 'remote');
  const app = apps.find(
    (a) => a.name === (where.startsWith(EXACT_APP) ? where.slice(EXACT_APP.length) : where),
  );
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

/** True when the part has no condition, or every option it names has the value it asks for. */
function applies(part: { when?: FeatureCondition }, options: Record<string, unknown>): boolean {
  return Object.entries(part.when ?? {}).every(([name, value]) => options[name] === value);
}

/** `relative` is the path inside the target app; `file` is the project path it ends up at. */
function assertWritable(file: string, relative: string, trusted: boolean): void {
  if (!isSafeRelativePath(file)) throw new MfeflowError('E105', `"${file}"`);
  if (trusted) assertSafeTarget(file);
  else assertThirdPartyPath(relative, file);
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
  const { feature, project } = input;
  const builder = input.builder.scoped(feature.trust);
  const { manifest } = feature;
  await builder.captureProject();
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
    app: { name: place.name, kind: place.kind, path: place.dir, port: place.port },
  });

  const steps: (() => Promise<void>)[] = [];

  for (const file of (manifest.files ?? []).filter((f) => applies(f, options))) {
    for (const place of placesFor(file.target, project)) {
      const to = joinPosix(place.dir, file.to);
      assertWritable(to, file.to, trusted);
      steps.push(async () => builder.create(to, await contentOf(file, feature, dataFor(place))));
    }
  }

  for (const dep of (manifest.dependencies ?? []).filter((d) => applies(d, options))) {
    for (const place of placesFor(dep.target, project)) {
      const pkg = joinPosix(place.dir, 'package.json');
      steps.push(() => builder.addDependency(pkg, dep.name, dep.range, dep.dev));
    }
  }

  for (const script of (manifest.scripts ?? []).filter((x) => applies(x, options))) {
    for (const place of placesFor(script.target, project)) {
      const pkg = joinPosix(place.dir, 'package.json');
      if (!trusted) assertPlainScript(script.name, manifest.name);
      steps.push(() => builder.addScript(pkg, script.name, script.command));
    }
  }

  for (const declared of (manifest.transforms ?? []).filter((t) => applies(t, options))) {
    if (!trusted) assertThirdPartyTransform(declared, manifest.name);
    const transform =
      !trusted && declared.op === 'add-env-key'
        ? { ...declared, schema: sanitizeSchema(declared.schema, manifest.name) }
        : declared;
    for (const place of placesFor(transform.target, project)) {
      if (transform.op === 'add-workflow-step') {
        const where = joinPosix(place.dir, transform.file);
        builder.warn(
          `${manifest.name} edits the CI workflow ${where} (adds step "${transform.step.name}")`,
        );
      }
      const files = transform.op === 'add-env-key' ? envKeyFiles(transform) : [transform.file];
      for (const rel of files) {
        const file = joinPosix(place.dir, rel);
        assertWritable(file, rel, trusted);
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
        if (trusted && transform.scope === 'server') {
          const { key } = transform;
          steps.push(async () => {
            if (await builder.exists(TURBO_FILE)) {
              await builder.patch(TURBO_FILE, (source) => addTurboEnv(source, TURBO_FILE, key));
            }
          });
        }
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
