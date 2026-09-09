/**
 * Russian licence plates use only the twelve Cyrillic letters that have a Latin
 * look-alike (А В Е К М Н О Р С Т У Х). The same plate is often typed in either
 * script, so matching has to happen on a normalised form.
 */
const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H",
  О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
};

/**
 * Canonical form of a plate for equality checks: upper-cased, stripped of
 * everything but letters and digits, with look-alike Cyrillic letters folded to
 * Latin. `"а 123 вс 125"` and `"A123BC125"` both become `"A123BC125"`.
 * Returns `""` for empty input.
 */
export function normalizePlate(raw: string | undefined | null): string {
  if (!raw) return "";
  const upper = raw.toUpperCase().replace(/[^0-9A-ZА-ЯЁ]/g, "");
  let out = "";
  for (const ch of upper) out += CYRILLIC_TO_LATIN[ch] ?? ch;
  return out;
}

/** True when two plates refer to the same vehicle after normalisation. */
export function platesMatch(a: string | undefined | null, b: string | undefined | null): boolean {
  const na = normalizePlate(a);
  return na.length > 0 && na === normalizePlate(b);
}
