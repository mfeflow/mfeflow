import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useForm } from 'react-hook-form';
import { contactSchema, type ContactValues } from './schema';

interface ContactFormProps {
  /** Called with the validated values. The button stays disabled until the promise settles, so a double click sends once. */
  onSubmit: (values: ContactValues) => void | Promise<void>;
}

/**
 * An example to copy from. Load it where you need it with `lazy(() => import('./forms/ContactForm').then((m) => ({ default: m.ContactForm })))`,
 * so the form library and the schema stay out of the remote's first load.
 */
export function ContactForm({ onSubmit }: ContactFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactValues>({
    resolver: standardSchemaResolver(contactSchema),
    defaultValues: { name: '', email: '', message: '' },
  });
  return (
    <form
      noValidate
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
    >
      <label>
        Name
        <input {...register('name')} aria-invalid={errors.name ? 'true' : 'false'} />
      </label>
      {errors.name ? <p role="alert">{errors.name.message}</p> : null}
      <label>
        Email
        <input type="email" {...register('email')} aria-invalid={errors.email ? 'true' : 'false'} />
      </label>
      {errors.email ? <p role="alert">{errors.email.message}</p> : null}
      <label>
        Message
        <textarea {...register('message')} aria-invalid={errors.message ? 'true' : 'false'} />
      </label>
      {errors.message ? <p role="alert">{errors.message.message}</p> : null}
      <button type="submit" disabled={isSubmitting}>
        Send
      </button>
    </form>
  );
}
