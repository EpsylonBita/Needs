import { z } from 'zod';

export const contactSchema = z.object({
  firstName: z.string().trim().min(1, 'Please enter your first name.').max(100),
  lastName: z.string().trim().min(1, 'Please enter your last name.').max(100),
  email: z.string().trim().email('Please enter a valid email address.').max(254),
  subject: z.string().trim().min(1, 'Please enter a subject.').max(200),
  message: z.string().trim().min(10, 'Please enter a message of at least 10 characters.').max(5000),
}).strict();
