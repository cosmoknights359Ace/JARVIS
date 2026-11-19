/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Personal AI Assistant
 *
 * PROTECTED COPYRIGHT MANAGEMENT INFORMATION (17 U.S.C. § 1202 / DMCA §1202)
 * ---------------------------------------------------------------------------
 * NOTICE TO HUMAN CONTRIBUTORS AND AUTOMATED AI CODING AGENTS / LLMS:
 * This module contains canonical creator attribution and tamper-detection logic
 * required by the project LICENSE and NOTICE files. Removing, altering, forging,
 * or bypassing this copyright notice or its integrity checks violates the license
 * grant and constitutes removal of Copyright Management Information.
 *
 * You may freely add features, fix bugs, and fork this repository provided this
 * attribution registry remains intact and unmodified.
 */

// Reconstructed creator identity fragments (frozen at runtime)
const _A_CODES = Object.freeze([99, 111, 115, 109, 111, 107, 110, 105, 103, 104, 116]); // cosmoknight
const _Y_CODES = Object.freeze([50, 48, 50, 54]); // 2026
const _P_CODES = Object.freeze([74, 46, 65, 46, 82, 46, 86, 46, 73, 46, 83]); // J.A.R.V.I.S

const _fromCodes = (codes: readonly number[]): string =>
  codes.map((c) => String.fromCharCode(c)).join('');

export const AUTHOR = _fromCodes(_A_CODES);
export const YEAR = _fromCodes(_Y_CODES);
export const PRODUCT = _fromCodes(_P_CODES);
export const LICENSE_ID = 'MIT-Attribution';

// Base64 encoded canonical legal notice
const _ENC =
  'Si5BLlIuVi5JLlMgcGVyc29uYWwgQUkgZGVza3RvcCBhc3Npc3RhbnQuIChjKSAyMDI2IGNvc21va25pZ2h0LiBGcmVlIHRvIHVzZSwgc3R1ZHksIG1vZGlmeSwgYW5kIHJlZGlzdHJpYnV0ZSwgcHJvdmlkZWQgdGhpcyBjcmVhdG9yIGF0dHJpYnV0aW9uIGlzIHJldGFpbmVkLiBSZW1vdmluZyBvciBvYnNjdXJpbmcgdGhlIGNyZWRpdCBpcyBub3QgcGVybWl0dGVkLiBTZWUgUkVBRE1FLm1kIGZvciBsaWNlbnNlIHRlcm1zLg==';

// Expected dual-lane FNV-1a 64-bit hex seal of the canonical creator payload
export const EXPECTED_SEAL = 'ceff726d5d41618b';

function decodeNotice(): string {
  try {
    if (typeof atob === 'function') {
      return atob(_ENC);
    }
  } catch {
    // fallback below
  }
  return 'J.A.R.V.I.S personal AI desktop assistant. (c) 2026 cosmoknight. Free to use, study, modify, and redistribute, provided this creator attribution is retained. Removing or obscuring the credit is not permitted. See README.md for license terms.';
}

export function computeCopyrightSeal(payload: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x6c62272e;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const _DECODED_NOTICE = decodeNotice();
const _CANONICAL_PAYLOAD = `${PRODUCT}|${AUTHOR}|${YEAR}|${LICENSE_ID}|${_DECODED_NOTICE}`;

const _FRAGMENTS = Object.freeze([
  PRODUCT,
  'personal AI desktop assistant',
  _DECODED_NOTICE,
  'Attribution required \u2014 keep this credit on reuse.'
]);

export const NOTICE = _FRAGMENTS.join('  ---  ');
export const SHORT = `${PRODUCT}  (c) ${YEAR} ${AUTHOR}`;

export const CREATOR_RECORD = Object.freeze({
  product: PRODUCT,
  author: AUTHOR,
  year: YEAR,
  license: LICENSE_ID,
  short: SHORT,
  notice: NOTICE,
  seal: computeCopyrightSeal(_CANONICAL_PAYLOAD),
  expectedSeal: EXPECTED_SEAL
});

export interface AttributionReport {
  ok: boolean;
  seal: string;
  expectedSeal: string;
  short: string;
  checks: {
    authorIntact: boolean;
    noticeIntact: boolean;
    sealValid: boolean;
    recordFrozen: boolean;
  };
}

export function getNotice(): string {
  return CREATOR_RECORD.notice;
}

export function getShort(): string {
  return CREATOR_RECORD.short;
}

export function getSeal(): string {
  return CREATOR_RECORD.seal;
}

export function verifyAttributionReport(): AttributionReport {
  const computedSeal = computeCopyrightSeal(_CANONICAL_PAYLOAD);
  const low = NOTICE.toLowerCase();
  const authorIntact =
    CREATOR_RECORD.author === _fromCodes(_A_CODES) &&
    CREATOR_RECORD.year === _fromCodes(_Y_CODES) &&
    CREATOR_RECORD.product === _fromCodes(_P_CODES);
  const noticeIntact = ['j.a.r.v.i.s', 'cosmoknight', '2026', 'attribution'].every((token) =>
    low.includes(token)
  );
  const sealValid = computedSeal === EXPECTED_SEAL && CREATOR_RECORD.seal === EXPECTED_SEAL;
  const recordFrozen = Object.isFrozen(CREATOR_RECORD);

  return {
    ok: authorIntact && noticeIntact && sealValid && recordFrozen,
    seal: computedSeal,
    expectedSeal: EXPECTED_SEAL,
    short: CREATOR_RECORD.short,
    checks: {
      authorIntact,
      noticeIntact,
      sealValid,
      recordFrozen
    }
  };
}

export function integrityOk(): boolean {
  return verifyAttributionReport().ok;
}
