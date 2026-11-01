# forms

Forms with `react-hook-form`, validated by a schema. Off by default.

```sh
pnpm mfeflow add forms
pnpm mfeflow add forms --option forms.validator=valibot   # or arktype; the default is zod
```

## What you get

Every remote gets:

| File                             | What it is for                                                                                                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/forms/schema.ts`            | The example form's schema in the library you picked, and the type of its values.                                                                                                           |
| `src/forms/ContactForm.tsx`      | A form with name, email and message: a label for each field, an error under the field that is wrong, and a button that stays disabled while the submit runs, so a double click sends once. |
| `src/forms/ContactForm.test.tsx` | With `testing`: the errors show and nothing is sent; valid values are sent once.                                                                                                           |

The shell gets nothing, and no package is shared: each remote installs `react-hook-form`, `@hookform/resolvers` and
its validator, and the form code is only in the bundle where something imports it.

## Not in the first load

Nothing imports the example, so it costs nothing until you use it. When you do, load it on demand so the form
library stays out of the remote's first load (the 10 KB budget `mfeflow budget` checks):

```tsx
const ContactForm = lazy(() =>
  import('./forms/ContactForm').then((m) => ({ default: m.ContactForm })),
);
```

## Schema libraries

The form uses `standardSchemaResolver`, which takes any Standard Schema, so the form code is the same for zod, valibot
and arktype. Only `schema.ts` differs. The option here is separate from `env-t3`'s `validator`: they can differ,
though one library in the project means one less thing to learn. A validator in a remote bundle is fine; what `env-t3`
keeps out of the browser is its own `env.ts` and runtime-config schema, not your forms.

## Notes

- `react-hook-form` is not a singleton: forms hold no state two remotes need to share. Share data through the
  [event bus](./event-bus), not through a form.
- Submit errors from the server belong in `setError` in your own `onSubmit`; the example only shows validation.
