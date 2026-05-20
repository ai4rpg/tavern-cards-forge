import * as z from 'zod';

export function mutuallyExclusive<T extends Record<string, unknown>>(
  keys: [string, string],
  messages?: { required?: string; exclusive?: string },
) {
  return (data: T, context: z.RefinementCtx) => {
    const [a, b] = keys;
    const hasA = data[a] !== undefined;
    const hasB = data[b] !== undefined;

    if (!hasA && !hasB) {
      keys.forEach(key =>
        context.addIssue({
          code: 'custom',
          path: [key],
          message: messages?.required ?? `必须填写 \`${a}\` 或 \`${b}\``,
        }),
      );
    }
    if (hasA && hasB) {
      keys.forEach(key =>
        context.addIssue({
          code: 'custom',
          path: [key],
          message: messages?.exclusive ?? `不能同时填写 \`${a}\` 和 \`${b}\``,
        }),
      );
    }
  };
}
