import * as clack from '@clack/prompts';
import { Cancelled } from './exit';

export interface Choice {
  value: string;
  label: string;
  hint?: string;
}

/** The prompts the commands use. The real one is clack; tests pass a scripted one. */
export interface Prompter {
  text(options: {
    message: string;
    initialValue?: string;
    validate?: (value: string) => string | undefined;
  }): Promise<string>;
  multiselect(options: {
    message: string;
    choices: readonly Choice[];
    initialValues: readonly string[];
  }): Promise<string[]>;
  select(options: {
    message: string;
    choices: readonly Choice[];
    initialValue?: string;
  }): Promise<string>;
  confirm(options: { message: string; initialValue?: boolean }): Promise<boolean>;
}

function answer<T>(value: T): Exclude<T, symbol> {
  if (clack.isCancel(value)) throw new Cancelled();
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- isCancel has ruled the symbol out
  return value as Exclude<T, symbol>;
}

export const clackPrompter: Prompter = {
  text: async ({ message, initialValue, validate }) =>
    answer(
      await clack.text({
        message,
        ...(initialValue === undefined ? {} : { initialValue }),
        ...(validate ? { validate: (value) => validate(value ?? '') } : {}),
      }),
    ),
  multiselect: async ({ message, choices, initialValues }) =>
    answer(
      await clack.multiselect({
        message,
        options: choices.map((c) => ({
          value: c.value,
          label: c.label,
          ...(c.hint === undefined ? {} : { hint: c.hint }),
        })),
        initialValues: [...initialValues],
        required: false,
      }),
    ),
  select: async ({ message, choices, initialValue }) =>
    answer(
      await clack.select({
        message,
        options: choices.map((c) => ({
          value: c.value,
          label: c.label,
          ...(c.hint === undefined ? {} : { hint: c.hint }),
        })),
        ...(initialValue === undefined ? {} : { initialValue }),
      }),
    ),
  confirm: async ({ message, initialValue }) =>
    answer(await clack.confirm({ message, initialValue: initialValue ?? true })),
};
