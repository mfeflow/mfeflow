/** The Standard Schema interface (https://standardschema.dev), copied here so no validator is a dependency. */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardResult<Output> | Promise<StandardResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

type StandardResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string }[] };

/**
 * Turns a Standard Schema (Zod 3.24+, Valibot 1+, ArkType 2+) into an event's `validate`. Failures
 * list the schema's messages and never the payload, so a rejected event cannot leak what was in it.
 *
 *   configureEvent('cart.item-added.v1', { validate: fromStandardSchema(itemAdded) });
 */
export function fromStandardSchema<Output>(
  schema: StandardSchemaV1<unknown, Output>,
): (payload: unknown) => Output {
  return (payload) => {
    const result = schema['~standard'].validate(payload);
    if (result instanceof Promise) {
      // Do not leave the rejection unhandled; the event is refused either way.
      result.catch(() => undefined);
      throw new TypeError(
        'the schema validates asynchronously, and events are delivered synchronously',
      );
    }
    if (result.issues) throw new TypeError(result.issues.map((issue) => issue.message).join('; '));
    return result.value;
  };
}
