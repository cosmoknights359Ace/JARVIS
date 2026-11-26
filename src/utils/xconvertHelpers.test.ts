import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatFileSize,
  getDefaultTargetFormat,
  getSharedCategoryBatchTargets,
  getRequiredMissingEngineHint
} from './xconvertHelpers';

test('formatFileSize formats bytes, KB, MB, and GB cleanly', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(512), '512 B');
  assert.equal(formatFileSize(1536), '1.5 KB');
  assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 MB');
  assert.equal(formatFileSize(3 * 1024 * 1024 * 1024), '3.00 GB');
});

test('getDefaultTargetFormat selects sensible default target formats', () => {
  assert.equal(getDefaultTargetFormat('png', ['jpg', 'webp', 'pdf']), 'jpg');
  assert.equal(getDefaultTargetFormat('pdf', ['docx', 'txt', 'md']), 'docx');
  assert.equal(getDefaultTargetFormat('csv', ['xlsx', 'json']), 'xlsx');
  assert.equal(getDefaultTargetFormat('zip', ['tar', 'tar.gz', '7z']), 'tar.gz');
  assert.equal(getDefaultTargetFormat('unknown', []), '');
});

test('getSharedCategoryBatchTargets returns common targets only when files share a category', () => {
  const sameCategory = getSharedCategoryBatchTargets([
    { category: 'image', compatibleTargets: ['jpg', 'webp', 'pdf'] },
    { category: 'image', compatibleTargets: ['png', 'webp', 'pdf'] }
  ]);
  assert.deepEqual(sameCategory, { category: 'image', targets: ['webp', 'pdf'] });

  const mixedCategories = getSharedCategoryBatchTargets([
    { category: 'image', compatibleTargets: ['jpg', 'webp'] },
    { category: 'data', compatibleTargets: ['csv', 'json'] }
  ]);
  assert.equal(mixedCategories, null);
});

test('getRequiredMissingEngineHint only reports missing engines needed by queued jobs', () => {
  const engines = {
    PIL: true,
    img2pdf: false,
    fitz: false,
    docx: true,
    pdf2docx: false,
    pandas: true,
    openpyxl: false,
    yaml: true,
    imageio_ffmpeg: false,
    py7zr: false,
    markdown: true
  };

  // PNG -> JPG only needs PIL (installed) -> no hint shown
  assert.equal(
    getRequiredMissingEngineHint(
      [{ ext: 'png', category: 'image', targetFormat: 'jpg' }],
      engines
    ),
    null
  );

  // CSV -> XLSX needs openpyxl (missing)
  assert.equal(
    getRequiredMissingEngineHint(
      [{ ext: 'csv', category: 'data', targetFormat: 'xlsx' }],
      engines
    ),
    'pip install openpyxl'
  );

  // ZIP -> 7Z needs py7zr (missing)
  assert.equal(
    getRequiredMissingEngineHint(
      [{ ext: 'zip', category: 'archive', targetFormat: '7z' }],
      engines
    ),
    'pip install py7zr'
  );
});
