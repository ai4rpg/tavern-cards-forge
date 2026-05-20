import { ZodType } from 'zod';

export function detailedParse<T>(schema: ZodType<T, any>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map(issue => `  path: ${issue.path.join('.')}\n  message: ${issue.message}`)
    .join('\n\n');

  throw new Error(`Validation failed:\n${issues}`);
}
