import { describe, expect, it } from 'vitest';
import { thrown } from '../testing';
import { addImport } from './add-import';

const run = (source: string, op: Omit<Parameters<typeof addImport>[2], 'op' | 'file'>) =>
  addImport(source, 'a.tsx', { op: 'add-import', file: 'a.tsx', ...op });

const base = `import React from 'react';
import { A, B } from './a';
import './x.css';

export const x = 1;
`;

describe('add-import', () => {
  it('adds a named import after the last import', () => {
    expect(run(base, { from: './b', named: ['C'] })).toBe(
      `import React from 'react';
import { A, B } from './a';
import './x.css';
import { C } from './b';

export const x = 1;
`,
    );
  });

  it('merges names into an existing import from the same module', () => {
    expect(run(base, { from: './a', named: ['B', 'C', 'D'] })).toContain(
      "import { A, B, C, D } from './a';",
    );
  });

  it('merges into a multi-line import one name per line', () => {
    const source = `import {\n  A,\n  B,\n} from './a';\n`;
    expect(run(source, { from: './a', named: ['C'] })).toBe(
      `import {\n  A,\n  B,\n  C,\n} from './a';\n`,
    );
  });

  it('adds default, namespace and side-effect imports', () => {
    expect(run(base, { from: './d', default: 'D' })).toContain("import D from './d';");
    expect(run(base, { from: './n', namespace: 'N' })).toContain("import * as N from './n';");
    expect(run(base, { from: './s.css' })).toContain("import './s.css';");
    expect(run(base, { from: './d', default: 'D', named: ['E'] })).toContain(
      "import D, { E } from './d';",
    );
  });

  it('adds a type-only import separately from value imports', () => {
    const out = run(base, { from: './a', named: ['T'], typeOnly: true });
    expect(out).toContain("import type { T } from './a';");
    expect(out).toContain("import { A, B } from './a';");
  });

  it('keeps double quotes when the file uses them', () => {
    expect(run('import a from "a";\n', { from: 'b', named: ['B'] })).toBe(
      'import a from "a";\nimport { B } from "b";\n',
    );
  });

  it('inserts after a directive, or at the top of a file without imports', () => {
    expect(run(`'use client';\n\nexport const x = 1;\n`, { from: 'a', named: ['A'] })).toBe(
      `'use client';\n\nimport { A } from 'a';\n\nexport const x = 1;\n`,
    );
    expect(run('export const x = 1;\n', { from: 'a', named: ['A'] })).toBe(
      "import { A } from 'a';\n\nexport const x = 1;\n",
    );
    expect(run('', { from: 'a', named: ['A'] })).toBe("import { A } from 'a';\n");
  });

  it('is idempotent', () => {
    const ops = [
      { from: './b', named: ['C'] },
      { from: './a', named: ['C'] },
      { from: './d', default: 'D', named: ['E'] },
      { from: './n', namespace: 'N' },
      { from: './s.css' },
      { from: './a', named: ['T'], typeOnly: true },
    ];
    for (const op of ops) {
      const once = run(base, op);
      expect(run(once, op)).toBe(once);
    }
  });

  it('returns the source untouched when everything is already imported', () => {
    expect(run(base, { from: './a', named: ['A'] })).toBe(base);
    expect(run(base, { from: 'react', default: 'React' })).toBe(base);
    expect(run(base, { from: './x.css' })).toBe(base);
  });

  it('reports unparseable source as E208', () => {
    expect(thrown(() => run('import {', { from: 'a', named: ['A'] })).code).toBe('MFEFLOW_E208');
  });

  it('inserts after a #! interpreter line, and after directives that follow it', () => {
    const cli = '#!/usr/bin/env node\nconsole.log(1);\n';
    expect(run(cli, { from: './b', named: ['C'] })).toBe(
      "#!/usr/bin/env node\nimport { C } from './b';\n\nconsole.log(1);\n",
    );
    expect(run('#!/usr/bin/env node\n', { from: './b' })).toBe(
      "#!/usr/bin/env node\nimport './b';\n",
    );
    const strict = "#!/usr/bin/env node\n'use strict';\nrun();\n";
    expect(run(strict, { from: './b', named: ['C'] })).toBe(
      "#!/usr/bin/env node\n'use strict';\n\nimport { C } from './b';\nrun();\n",
    );
    const once = run(cli, { from: './b', named: ['C'] });
    expect(run(once, { from: './b', named: ['C'] })).toBe(once);
  });
});
