import path from 'node:path';
import {
  redactUrl,
  registryIndexUrl,
  registryTemplateProblem,
  REGISTRY_NAMESPACE,
  type MfeflowProject,
} from '@mfeflow/contracts';
import {
  addTrusted,
  buildRegistry,
  findProjectRoot,
  inOrder,
  isMfeflowError,
  loadProject,
  MfeflowError,
  readTrusted,
  realFs,
  removeTrusted,
  saveProject,
  TRUST_ENV,
  writeFileAtomic,
} from '@mfeflow/core';
import type { ArgsDef } from 'citty';
import { assertKnownFlags, GLOBAL_ARGS, readGlobals, text, type Globals } from '../args';
import { Cancelled } from '../exit';
import type { RegistryEntryInfo, RegistryResult } from '../output';
import type { Runtime } from '../runtime';
import { trustedIn } from '../trust';

export const REGISTRY_ARGS = {
  out: {
    type: 'string',
    description: 'registry build: the folder to write (default: <dir>/dist)',
    valueHint: 'dir',
  },
  ...GLOBAL_ARGS,
} as const satisfies ArgsDef;

const USAGE =
  'mfeflow registry add @namespace <url-template> | list | remove @namespace | trust @namespace | untrust @namespace | build <dir>';

async function entries(rt: Runtime, project: MfeflowProject): Promise<RegistryEntryInfo[]> {
  const trusted = await trustedIn(rt, project.registries);
  return Object.entries(project.registries ?? {})
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([namespace, url]) => ({
      namespace,
      url: redactUrl(url),
      index: redactUrl(registryIndexUrl(url)),
      trusted: trusted.has(namespace),
    }));
}

function result(
  action: RegistryResult['action'],
  globals: Globals,
  extra: Partial<RegistryResult> & Pick<RegistryResult, 'registries'>,
): RegistryResult {
  return {
    ok: true,
    command: 'registry',
    action,
    dryRun: globals.dryRun,
    root: null,
    changed: false,
    build: null,
    ...extra,
  };
}

function assertNamespace(namespace: string | undefined, verb: string): string {
  if (namespace === undefined)
    throw new MfeflowError('E107', `registry ${verb} needs a namespace like @someone`);
  if (namespace === '@mfeflow') {
    throw new MfeflowError('E107', '@mfeflow is reserved for the features that ship with mfeflow');
  }
  if (!REGISTRY_NAMESPACE.test(namespace)) {
    throw new MfeflowError(
      'E107',
      `"${namespace}" is not a namespace; they start with @ and use lower-case letters, digits and "-" (for example @someone)`,
    );
  }
  return namespace;
}

async function projectOf(globals: Globals): Promise<{ root: string; project: MfeflowProject }> {
  const root = await findProjectRoot(globals.cwd);
  return { root, project: await loadProject(root) };
}

async function save(
  globals: Globals,
  root: string,
  project: MfeflowProject,
  registries: Record<string, string>,
): Promise<MfeflowProject> {
  const { registries: _old, ...rest } = project;
  const next: MfeflowProject = Object.keys(registries).length > 0 ? { ...rest, registries } : rest;
  if (!globals.dryRun) await saveProject(root, next);
  return next;
}

async function addRegistry(
  rt: Runtime,
  globals: Globals,
  namespaceArg: string | undefined,
  url: string | undefined,
): Promise<RegistryResult> {
  const namespace = assertNamespace(namespaceArg, 'add');
  if (url === undefined) {
    throw new MfeflowError(
      'E107',
      `registry add needs a URL: mfeflow registry add ${namespace} https://example.com/{name}.json`,
    );
  }
  const problem = registryTemplateProblem(url);
  if (problem !== undefined) throw new MfeflowError('E107', `the URL ${problem}`);
  const { root, project } = await projectOf(globals);
  const current = project.registries ?? {};
  const existing = current[namespace];
  const shown = redactUrl(url);
  if (existing === url) {
    const newlyTrusted =
      !globals.dryRun && (await addTrusted(rt.configDir, { namespace, template: url }));
    if (!globals.json) {
      rt.io.stdout(
        `${namespace} already points at ${shown}; nothing to do${newlyTrusted ? ' except trust it' : ''}.`,
      );
    }
    return result('add', globals, { root, registries: await entries(rt, project) });
  }
  if (existing !== undefined) {
    throw new MfeflowError('E107', `${namespace} already points at ${redactUrl(existing)}`, {
      fix: `Run \`mfeflow registry remove ${namespace}\` first, then add it again.`,
    });
  }
  const next = await save(globals, root, project, { ...current, [namespace]: url });
  if (!globals.dryRun) await addTrusted(rt.configDir, { namespace, template: url });
  if (!globals.json) {
    rt.io.stdout(
      globals.dryRun
        ? `Dry run: would add and trust ${namespace} -> ${shown}. Nothing was written.`
        : `Added ${namespace} -> ${shown} and trusted it on this machine.\nSee what it offers: mfeflow features`,
    );
  }
  return result('add', globals, { root, changed: true, registries: await entries(rt, next) });
}

async function removeRegistry(
  rt: Runtime,
  globals: Globals,
  namespaceArg: string | undefined,
): Promise<RegistryResult> {
  const namespace = assertNamespace(namespaceArg, 'remove');
  const { root, project } = await projectOf(globals);
  const { [namespace]: url, ...rest } = project.registries ?? {};
  if (url === undefined) {
    throw new MfeflowError('E107', `${namespace} is not in this project's registries`, {
      fix: 'List them with `mfeflow registry list`.',
    });
  }
  const using = Object.keys(project.features).filter((name) => name.startsWith(`${namespace}/`));
  if (using.length > 0) {
    throw new MfeflowError('E107', `${using.join(', ')} installed from ${namespace}`, {
      fix: `Keep ${namespace} while they are installed: \`mfeflow add remote\` and \`add shell\` fetch them again and fail without it.`,
    });
  }
  const next = await save(globals, root, project, rest);
  if (!globals.json) {
    rt.io.stdout(
      globals.dryRun
        ? `Dry run: would remove ${namespace}. Nothing was written.`
        : `Removed ${namespace} (${redactUrl(url)}).`,
    );
  }
  return result('remove', globals, { root, changed: true, registries: await entries(rt, next) });
}

async function listRegistries(rt: Runtime, globals: Globals): Promise<RegistryResult> {
  const { root, project } = await projectOf(globals);
  const registries = await entries(rt, project);
  if (!globals.json) {
    if (registries.length === 0) {
      rt.io.stdout(
        'No registries. Add one: mfeflow registry add @namespace https://example.com/{name}.json',
      );
    } else {
      const width = Math.max(...registries.map((r) => r.namespace.length));
      rt.io.stdout(
        registries
          .map(
            (r) =>
              `  ${r.namespace.padEnd(width)}  ${r.url}  [${r.trusted ? 'trusted' : 'not trusted yet'}]`,
          )
          .join('\n'),
      );
      if (registries.some((r) => !r.trusted)) {
        rt.io.stdout('\nTrust one with: mfeflow registry trust @namespace');
      }
    }
  }
  return result('list', globals, { root, registries });
}

async function trustRegistry(
  rt: Runtime,
  globals: Globals,
  namespaceArg: string | undefined,
): Promise<RegistryResult> {
  const namespace = assertNamespace(namespaceArg, 'trust');
  const { root, project } = await projectOf(globals);
  const template = project.registries?.[namespace];
  if (template === undefined) {
    throw new MfeflowError('E107', `${namespace} is not in this project's registries`, {
      fix: 'List them with `mfeflow registry list`, or add it with `mfeflow registry add`.',
    });
  }
  const shown = redactUrl(template);
  const recorded = await readTrusted(rt.configDir);
  const already = recorded.some((e) => e.namespace === namespace && e.template === template);
  if (!already && !globals.dryRun) {
    if (globals.canPrompt) {
      const yes = await rt.prompter.confirm({
        message: `Trust ${namespace} (${shown})? mfeflow will request its index and features from that address.`,
      });
      if (!yes) throw new Cancelled();
    } else if (!globals.yes) {
      throw new MfeflowError(
        'E107',
        `trusting ${namespace} needs a person to confirm it; pass --yes to trust it without a terminal (or set ${TRUST_ENV}=${namespace} for one run)`,
      );
    }
    await addTrusted(rt.configDir, { namespace, template });
  }
  if (!globals.json) {
    rt.io.stdout(
      globals.dryRun
        ? `Dry run: would trust ${namespace} (${shown}). Nothing was written.`
        : already
          ? `${namespace} is already trusted.`
          : `Trusted ${namespace} (${shown}) on this machine.`,
    );
  }
  return result('trust', globals, {
    root,
    changed: !already,
    registries: await entries(rt, project),
  });
}

async function untrustRegistry(
  rt: Runtime,
  globals: Globals,
  namespaceArg: string | undefined,
): Promise<RegistryResult> {
  const namespace = assertNamespace(namespaceArg, 'untrust');
  let found: { root: string; project: MfeflowProject } | undefined;
  try {
    found = await projectOf(globals);
  } catch (error) {
    if (!isMfeflowError(error) || error.code !== 'MFEFLOW_E102') throw error;
  }
  const recorded = (await readTrusted(rt.configDir)).some((e) => e.namespace === namespace);
  if (recorded && !globals.dryRun) await removeTrusted(rt.configDir, namespace);
  if (!globals.json) {
    rt.io.stdout(
      !recorded
        ? `${namespace} was not trusted; nothing to do.`
        : globals.dryRun
          ? `Dry run: would stop trusting ${namespace}. Nothing was written.`
          : `No longer trusting ${namespace}. mfeflow features will not request it.`,
    );
  }
  return result('untrust', globals, {
    root: found?.root ?? null,
    changed: recorded,
    registries: found === undefined ? [] : await entries(rt, found.project),
  });
}

async function buildFolder(
  rt: Runtime,
  globals: Globals,
  args: Record<string, unknown>,
  dirArg: string | undefined,
): Promise<RegistryResult> {
  if (dirArg === undefined) {
    throw new MfeflowError(
      'E107',
      'registry build needs the folder that holds your features: mfeflow registry build ./my-registry',
    );
  }
  const dir = path.resolve(globals.cwd, dirArg);
  const out = path.resolve(globals.cwd, text(args, 'out') ?? path.join(dirArg, 'dist'));
  const built = await buildRegistry(dir);
  if (!globals.dryRun) {
    await inOrder(built.files, (file) =>
      writeFileAtomic(realFs, path.join(out, ...file.path.split('/')), file.content),
    );
  }
  if (!globals.json) {
    const lines = built.features.map((f) => `  ${f.name} ${f.version}`);
    rt.io.stdout(
      [
        `${globals.dryRun ? 'Dry run: would build' : 'Built'} ${String(built.features.length)} feature(s) for ${built.namespace}:`,
        ...lines,
        '',
        `${globals.dryRun ? 'Would write' : 'Wrote'} ${String(built.files.length)} files to ${out}`,
        '',
        `Host that folder on any static host (GitHub Pages works). Users then run:`,
        `  mfeflow registry add ${built.namespace} https://<your-host>/{name}.json`,
      ].join('\n'),
    );
  }
  return result('build', globals, {
    registries: [],
    build: {
      namespace: built.namespace,
      out,
      features: built.features.map(({ name, version }) => ({ name, version })),
      files: built.files.map((f) => f.path),
    },
  });
}

export async function runRegistry(
  rt: Runtime,
  args: Record<string, unknown>,
  raw: readonly string[],
): Promise<RegistryResult> {
  assertKnownFlags(raw, REGISTRY_ARGS);
  const globals = readGlobals(args, rt.io.env, rt.io.cwd, rt.io.interactive);
  const positional = Array.isArray(args._) ? args._.map(String) : [];
  const [action, first, second] = positional;
  const takes: Record<string, number> = {
    add: 2,
    remove: 1,
    list: 0,
    build: 1,
    trust: 1,
    untrust: 1,
  };
  const surplus = positional[(takes[action ?? ''] ?? Number.POSITIVE_INFINITY) + 1];
  if (surplus !== undefined) {
    throw new MfeflowError('E107', `unexpected "${surplus}" (${USAGE})`);
  }
  switch (action) {
    case 'add':
      return addRegistry(rt, globals, first, second);
    case 'remove':
      return removeRegistry(rt, globals, first);
    case 'list':
      return listRegistries(rt, globals);
    case 'trust':
      return trustRegistry(rt, globals, first);
    case 'untrust':
      return untrustRegistry(rt, globals, first);
    case 'build':
      return buildFolder(rt, globals, args, first);
    case undefined:
    default:
      throw new MfeflowError(
        'E107',
        action === undefined
          ? `registry needs an action (${USAGE})`
          : `unknown action "${action}" (${USAGE})`,
      );
  }
}
