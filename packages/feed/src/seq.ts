/**
 * Sequence numbers are uint32 and wrap: after 4,294,967,295 comes 0. Plain `<`
 * would then call the newest ping the oldest. Serial-number arithmetic
 * (RFC 1982) compares by the signed 32-bit difference instead, which is
 * correct as long as two live sequence numbers are less than 2³¹ apart,
 * which, at one ping a second, is 68 years.
 */
export function seqDiff(a: number, b: number): number {
  return (a - b) | 0;
}

export const seqAfter = (a: number, b: number): boolean => seqDiff(a, b) > 0;
