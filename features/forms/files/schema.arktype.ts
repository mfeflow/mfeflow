import { type } from 'arktype';

export const contactSchema = type({
  name: 'string > 0',
  email: 'string.email',
  message: 'string >= 10',
});

export type ContactValues = typeof contactSchema.infer;
