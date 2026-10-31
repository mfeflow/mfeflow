// Every supported combination of the first-party features. `core` and `tsconfig` are always on.

export interface Combo {
  id: string;
  lint: boolean;
  url: boolean;
  hooks: boolean;
  remotes: 1 | 3;
}

export interface Step {
  name: string;
  command: 'mfeflow' | 'pnpm';
  args: string[];
}

const REMOTE_NAMES = ['catalog', 'cart', 'checkout'];

function make(lint: boolean, url: boolean, hooks: boolean, remotes: 1 | 3): Combo {
  const parts = [lint ? 'lint' : '', url ? 'url' : '', hooks ? 'hooks' : ''].filter(
    (p) => p !== '',
  );
  return {
    id: `${parts.length > 0 ? parts.join('-') : 'bare'}-r${String(remotes)}`,
    lint,
    url,
    hooks,
    remotes,
  };
}

/** All 16: lint on/off, url-factory on/off, git-hooks on/off, one or three remotes. */
export function combinations(): Combo[] {
  const flags = [false, true];
  const out: Combo[] = [];
  for (const lint of flags)
    for (const url of flags)
      for (const hooks of flags)
        for (const remotes of [1, 3] as const) out.push(make(lint, url, hooks, remotes));
  return out;
}

/** The corners: nothing on, everything on, and each feature alone. Enough to catch OS-specific breakage cheaply. */
export function edges(): Combo[] {
  return [
    make(false, false, false, 1),
    make(true, true, true, 3),
    make(true, false, false, 1),
    make(false, true, false, 3),
    make(false, false, true, 1),
  ];
}

export function find(ids: readonly string[]): Combo[] {
  const all = combinations();
  return ids.map((id) => {
    const found = all.find((c) => c.id === id);
    if (!found) throw new Error(`unknown combination "${id}" (try --list)`);
    return found;
  });
}

export function featuresOf(combo: Combo): string[] {
  return [
    ...(combo.lint ? ['lint-oxlint'] : []),
    ...(combo.url ? ['url-factory'] : []),
    ...(combo.hooks ? ['git-hooks'] : []),
  ];
}

/** The preset `mfeflow init` replays: an empty feature list is only expressible this way. */
export function presetOf(combo: Combo): { remotes: string[]; features: string[] } {
  return { remotes: REMOTE_NAMES.slice(0, combo.remotes), features: featuresOf(combo) };
}

/** What a person would run on the result, in order. Lint and format only exist with lint-oxlint. */
export function stepsFor(combo: Combo): Step[] {
  return [
    { name: 'install', command: 'pnpm', args: ['install'] },
    { name: 'doctor', command: 'mfeflow', args: ['doctor'] },
    { name: 'build', command: 'pnpm', args: ['build'] },
    { name: 'budget', command: 'mfeflow', args: ['budget'] },
    { name: 'typecheck', command: 'pnpm', args: ['typecheck'] },
    ...(combo.lint
      ? [
          { name: 'lint', command: 'pnpm', args: ['lint'] } satisfies Step,
          { name: 'format:check', command: 'pnpm', args: ['format:check'] } satisfies Step,
        ]
      : []),
    { name: 'validate', command: 'mfeflow', args: ['validate'] },
    { name: 'check-compat', command: 'mfeflow', args: ['check-compat'] },
  ];
}
