import test from 'node:test';
import assert from 'node:assert/strict';
import { blobToBase64, saveBlobFile } from './fileDownload';

test('blobToBase64 encodes binary blobs accurately without data URI prefix', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4, 0, 255, 128, 65]);
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const encoded = await blobToBase64(blob);
  const decoded = Buffer.from(encoded, 'base64');
  assert.deepEqual(Array.from(decoded), Array.from(bytes));
});

test('saveBlobFile delegates to window.pywebview.api.save_file when present', async () => {
  const calls: Array<{ filename: string; base64Data: string }> = [];
  const prevWindow = (globalThis as any).window;

  (globalThis as any).window = {
    pywebview: {
      api: {
        save_file: async (filename: string, base64Data: string) => {
          calls.push({ filename, base64Data });
          return { ok: true, path: `C:\\Users\\demo\\Downloads\\${filename}` };
        }
      }
    }
  };

  try {
    const blob = new Blob(['hello xfill'], { type: 'text/plain' });
    const res = await saveBlobFile(blob, 'report_filled.docx');

    assert.equal(res.saved, true);
    assert.equal(res.method, 'desktop');
    assert.equal(res.path, 'C:\\Users\\demo\\Downloads\\report_filled.docx');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].filename, 'report_filled.docx');
    assert.equal(Buffer.from(calls[0].base64Data, 'base64').toString('utf8'), 'hello xfill');
  } finally {
    (globalThis as any).window = prevWindow;
  }
});

test('saveBlobFile returns cancelled cleanly without throwing when user cancels native dialog', async () => {
  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {
    pywebview: {
      api: {
        save_file: async () => ({ ok: false, cancelled: true })
      }
    }
  };

  try {
    const blob = new Blob(['pptx bytes']);
    const res = await saveBlobFile(blob, 'deck.pptx');
    assert.equal(res.saved, false);
    assert.equal(res.cancelled, true);
    assert.equal(res.method, 'desktop');
  } finally {
    (globalThis as any).window = prevWindow;
  }
});
