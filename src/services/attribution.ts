/**
 * Attribution / anti-tamper registry for J.A.R.V.I.S.
 * Ported faithfully from attribution.py
 */

export const AUTHOR = "vinod";
export const YEAR = "2026";
export const PRODUCT = "J.A.R.V.I.S";

// Base64 encoded legal fragment
const _ENC = "Si5BLlIuVi5JLlMgcGVyc29uYWwgQUkgZGVza3RvcCBhc3Npc3RhbnQuIChjKSAyMDI2IHZpbm9kLiBGcmVlIHRvIHVzZSwgc3R1ZHksIG1vZGlmeSwgYW5kIHJlZGlzdHJpYnV0ZSwgcHJvdmlkZWQgdGhpcyBjcmVhdG9yIGF0dHJpYnV0aW9uIGlzIHJldGFpbmVkLiBSZW1vdmluZyBvciBvYnNjdXJpbmcgdGhlIGNyZWRpdCBpcyBub3QgcGVybWl0dGVkLiBTZWUgUkVBRE1FLm1kIGZvciBsaWNlbnNlIHRlcm1zLg==";

function decodeNotice(): string {
  try {
    return atob(_ENC);
  } catch {
    return "J.A.R.V.I.S personal AI desktop assistant. (c) 2026 vinod. Free to use, study, modify, and redistribute, provided this creator attribution is retained.";
  }
}

const _FRAGMENTS = [
  PRODUCT,
  "personal AI desktop assistant",
  decodeNotice(),
  "Attribution required \u2014 keep this credit on reuse."
];

export const NOTICE = _FRAGMENTS.join("  ---  ");
export const SHORT = `${PRODUCT}  (c) ${YEAR} ${AUTHOR}`;

export function getNotice(): string {
  return NOTICE;
}

export function getShort(): string {
  return SHORT;
}

export function integrityOk(): boolean {
  const req = ["J.A.R.V.I.S", "vinod", "2026", "attribution"];
  const low = NOTICE.toLowerCase();
  return req.every((r) => low.includes(r.toLowerCase()));
}
