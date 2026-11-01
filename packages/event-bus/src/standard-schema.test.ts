import { describe, expect, it } from 'vitest';
import { fromStandardSchema, type StandardSchemaV1 } from './standard-schema';

function schema(
  validate: StandardSchemaV1<unknown, { n: number }>['~standard']['validate'],
): StandardSchemaV1<unknown, { n: number }> {
  return { '~standard': { version: 1, vendor: 'test', validate } };
}

describe('fromStandardSchema', () => {
  it('returns the parsed value', () => {
    const validate = fromStandardSchema(schema((value) => ({ value: { n: Number(value) } })));
    expect(validate('3')).toEqual({ n: 3 });
  });

  it('throws the schema messages and never the payload', () => {
    const validate = fromStandardSchema(
      schema(() => ({ issues: [{ message: 'n must be a number' }, { message: 'n is required' }] })),
    );
    expect(() => validate({ email: 'jane@example.com' })).toThrow(
      'n must be a number; n is required',
    );
    expect(() => validate({ email: 'jane@example.com' })).not.toThrow(/jane/);
  });

  it('refuses a schema that answers later', () => {
    const validate = fromStandardSchema(schema(() => Promise.resolve({ value: { n: 1 } })));
    expect(() => validate(1)).toThrow('asynchronously');
  });
});
