export const zeroToUndefined = (val: number | null | undefined): number | undefined =>
  val === 0 || val === null ? undefined : val;

