#!/usr/bin/env node
/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 cosmoknight — J.A.R.V.I.S Build & CI Copyright Integrity Guard
 *
 * Verifies that creator Copyright Management Information (LICENSE, NOTICE,
 * attribution seal, server verification, and AI agent policy files) remains
 * intact before building or merging changes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const EXPECTED_SEAL = 'ceff726d5d41618b';
const EXPECTED_ENC =
  'Si5BLlIuVi5JLlMgcGVyc29uYWwgQUkgZGVza3RvcCBhc3Npc3RhbnQuIChjKSAyMDI2IGNvc21va25pZ2h0LiBGcmVlIHRvIHVzZSwgc3R1ZHksIG1vZGlmeSwgYW5kIHJlZGlzdHJpYnV0ZSwgcHJvdmlkZWQgdGhpcyBjcmVhdG9yIGF0dHJpYnV0aW9uIGlzIHJldGFpbmVkLiBSZW1vdmluZyBvciBvYnNjdXJpbmcgdGhlIGNyZWRpdCBpcyBub3QgcGVybWl0dGVkLiBTZWUgUkVBRE1FLm1kIGZvciBsaWNlbnNlIHRlcm1zLg==';

function computeSeal(payload) {
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

const failures = [];

function checkFile(relPath, requiredSubstrings) {
  const fullPath = path.join(ROOT, relPath);
  if (!fs.existsSync(fullPath)) {
    failures.push(`Missing required copyright/policy file: ${relPath}`);
    return;
  }
  const content = fs.readFileSync(fullPath, 'utf8');
  for (const snippet of requiredSubstrings) {
    if (!content.includes(snippet)) {
      failures.push(`${relPath} is missing required attribution text: "${snippet}"`);
    }
  }
}

// 1. Canonical seal verification
const decoded = Buffer.from(EXPECTED_ENC, 'base64').toString('utf8');
const canonical = `J.A.R.V.I.S|cosmoknight|2026|MIT-Attribution|${decoded}`;
const actualSeal = computeSeal(canonical);
if (actualSeal !== EXPECTED_SEAL) {
  failures.push(`Canonical copyright seal mismatch: expected ${EXPECTED_SEAL}, got ${actualSeal}`);
}

// 2. Legal & Notice files
checkFile('LICENSE', ['Copyright (c) 2026 cosmoknight', 'J.A.R.V.I.S', 'NOT permitted']);
checkFile('NOTICE', ['Copyright (c) 2026 cosmoknight', EXPECTED_SEAL, '17 U.S.C. § 1202']);

// 3. Client attribution registry
checkFile('src/services/attribution.ts', [
  EXPECTED_SEAL,
  EXPECTED_ENC,
  'Object.freeze',
  'verifyAttributionReport',
  '17 U.S.C. § 1202'
]);

// 4. Server cross-verification & response header
checkFile('server.ts', [
  'X-Creator-Attribution',
  'verifyServerAttribution',
  'ceff726d5d41618b'
]);

// 5. AI coding agent directives
checkFile('AGENTS.md', ['cosmoknight', 'attribution']);
checkFile('CLAUDE.md', ['Copyright (c) 2026 cosmoknight', '17 U.S.C. § 1202']);
checkFile('.cursorrules', ['Copyright (c) 2026 cosmoknight', 'src/services/attribution.ts']);
checkFile('.github/copilot-instructions.md', ['Copyright (c) 2026 cosmoknight', 'src/services/attribution.ts']);

if (failures.length > 0) {
  console.error('\n[COPYRIGHT INTEGRITY CHECK FAILED]');
  console.error('Creator attribution for J.A.R.V.I.S (c) 2026 cosmoknight has been altered or removed:\n');
  for (const f of failures) {
    console.error(`  - ${f}`);
  }
  console.error('\nRestore creator attribution per LICENSE and NOTICE to proceed.\n');
  process.exit(1);
}

console.log(`[COPYRIGHT OK] J.A.R.V.I.S (c) 2026 cosmoknight · Seal ${actualSeal} verified.`);
