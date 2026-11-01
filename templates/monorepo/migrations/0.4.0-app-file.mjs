// core 0.4.0: each app's ownership file is now mfeflow.app.json, not mfe.json.
// Moves the content of every app's mfe.json to mfeflow.app.json, with the schema URL updated,
// and deletes mfe.json. An app that already has both files is left alone with a warning (E122).
// Self-contained on purpose: `mfeflow upgrade` imports it from the feature folder.

const OLD = 'mfe.json';
const NEW = 'mfeflow.app.json';
const OLD_SCHEMA = 'https://mfeflow.github.io/mfeflow/schema/mfe.json';
const NEW_SCHEMA = 'https://mfeflow.github.io/mfeflow/schema/mfeflow-app.json';

const inApp = (dir, file) => (dir === '' ? file : `${dir}/${file}`);

/** The file text with the new schema URL: the old URL replaced, or a `$schema` line added first. */
export function withNewSchema(text) {
  if (text.includes(OLD_SCHEMA)) return text.replaceAll(OLD_SCHEMA, NEW_SCHEMA);
  if (text.includes('"$schema"')) return text;
  const open = /^\{(\r?\n)/.exec(text);
  if (!open) return text;
  return `{${open[1]}  "$schema": "${NEW_SCHEMA}",${open[1]}${text.slice(open[0].length)}`;
}

/**
 * @param {import('@mfeflow/core').PlanBuilder} builder
 * @param {import('@mfeflow/core').MfeflowProject} project
 */
export default async function migrate(builder, project) {
  const dirs = Object.values(project.apps)
    .map((app) => app.path)
    .toSorted();
  for (const dir of dirs) {
    const from = inApp(dir, OLD);
    const to = inApp(dir, NEW);
    // oxlint-disable-next-line no-await-in-loop -- apps in order keep the plan deterministic
    const text = await builder.content(from);
    if (text === undefined) continue;
    // oxlint-disable-next-line no-await-in-loop -- see above
    if (await builder.existed(to)) {
      builder.warn(
        `${dir || '.'} has both ${OLD} and ${NEW}; keep ${NEW} and delete ${OLD} (E122)`,
      );
      continue;
    }
    const moved = withNewSchema(text);
    // The upgrade may already plan a fresh NEW file from the template. When the old file was
    // never edited the two match and that tracked file stays. Otherwise your content wins, and
    // it is not tracked, so a later upgrade shows a diff instead of replacing it.
    // oxlint-disable-next-line no-await-in-loop -- see above
    const planned = await builder.content(to);
    if (planned !== moved) {
      // oxlint-disable-next-line no-await-in-loop -- see above
      if (planned !== undefined) await builder.delete(to);
      // oxlint-disable-next-line no-await-in-loop -- see above
      await builder.create(to, moved, false);
    }
    // oxlint-disable-next-line no-await-in-loop -- see above
    await builder.delete(from);
  }
}
