import { z } from 'zod';

export const contactSchema = z.object({
  name: z.string().min(1, 'Enter your name'),
  email: z.email('Enter a valid email address'),
  message: z.string().min(10, 'Say a little more (at least 10 characters)'),
});

export type ContactValues = z.infer<typeof contactSchema>;
