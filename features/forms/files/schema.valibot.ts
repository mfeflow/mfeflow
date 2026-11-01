import * as v from 'valibot';

export const contactSchema = v.object({
  name: v.pipe(v.string(), v.minLength(1, 'Enter your name')),
  email: v.pipe(v.string(), v.email('Enter a valid email address')),
  message: v.pipe(v.string(), v.minLength(10, 'Say a little more (at least 10 characters)')),
});

export type ContactValues = v.InferOutput<typeof contactSchema>;
