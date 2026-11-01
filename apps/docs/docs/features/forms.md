---
title: forms - validated forms per remote
description: react-hook-form with a schema from zod, valibot or arktype, as an example form each remote owns and loads only where it is used.
---

# forms

Forms are where validation, error messages and double submits meet, and every team ends up rewriting them. This feature gives each remote a working contact form built on react-hook-form that you copy from and change.

## What you get

Each remote gets a schema, a `ContactForm` component with a label, an input and an error message for every field, and a test. The shell gets nothing, and no package is shared: each remote installs its own copy of the libraries.

## Add it

```sh
pnpm mfeflow add forms
```

The command asks which schema library to use and defaults to zod. To skip the question:

```sh
pnpm mfeflow add forms --option forms.validator=valibot
```

What changed, in every remote:

- `src/forms/schema.ts`, the schema in the library you picked
- `src/forms/ContactForm.tsx`
- `src/forms/ContactForm.test.tsx`, if you use [testing](/features/testing)
- `react-hook-form`, `@hookform/resolvers` and your validator added as dependencies

## Use it

The schema describes the fields and gives you the type of the values.

```ts title="apps/cart/src/forms/schema.ts"
import { z } from 'zod';

export const contactSchema = z.object({
  name: z.string().min(1, 'Enter your name'),
  email: z.email('Enter a valid email address'),
  message: z.string().min(10, 'Say a little more (at least 10 characters)'),
});

export type ContactValues = z.infer<typeof contactSchema>;
```

The form hands you validated values. The submit button stays disabled while your promise runs, so a double click sends once.

```tsx
<ContactForm
  onSubmit={async (values) => {
    await api.post('sendMessage', { json: values });
  }}
/>
```

Nothing imports the example yet, so it costs nothing until you use it. When you do, load it on demand so the form library stays out of the remote's first load.

```tsx
const ContactForm = lazy(() =>
  import('./forms/ContactForm').then((m) => ({ default: m.ContactForm })),
);
```

## Configure it

| Option            | Values                      | Default | Effect                                                 |
| ----------------- | --------------------------- | ------- | ------------------------------------------------------ |
| `forms.validator` | `zod`, `valibot`, `arktype` | `zod`   | Which library `schema.ts` is written in and installed. |

## How it works

The form uses `standardSchemaResolver`, which accepts any Standard Schema, so the form code is identical for all three libraries and only `schema.ts` differs. The option is separate from the `validator` of [env-t3](/features/env-t3), so the two can differ, although one library across the project is one less thing to learn. A validator inside a remote bundle is fine. What env-t3 keeps out of the browser is its own `env.ts` and runtime-config schema.

The test that comes with the form checks two things: errors show and nothing is sent when the values are wrong, and valid values are sent once even if the button is clicked twice.

## Gotchas

- The arktype schema does not set custom messages, so its errors read like arktype's own. Add messages there if you want wording like the zod example.
- Server errors belong in `setError`, inside your own `onSubmit`. The example only shows validation.
- `react-hook-form` is not a [shared singleton](/concepts/shared-singletons): forms hold no state two remotes need. Share data through the [event bus](/features/event-bus), not through a form.
- Mind the 10 KB default remote budget when you import the form eagerly.

## Reference

- [env-t3](/features/env-t3)
- [event-bus](/features/event-bus)
- [Cost model](/concepts/cost-model)
- [feature.json reference](/reference/feature-json)
