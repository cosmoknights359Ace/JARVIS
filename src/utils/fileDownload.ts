/**
 * Unified file download helper for both normal browsers and the native
 * `pywebview` (WebView2) desktop window.
 *
 * Inside `pywebview`, WebView2 frequently drops `blob:` downloads even when
 * `ALLOW_DOWNLOADS = True`. When `window.pywebview.api.save_file` is present,
 * we serialize the Blob to base64 and delegate to the native Python Save dialog.
 */

export interface DesktopSaveResult {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface SaveFileOutcome {
  saved: boolean;
  cancelled?: boolean;
  path?: string;
  method: 'desktop' | 'browser';
}

declare global {
  interface Window {
    pywebview?: {
      api?: {
        save_file?: (filename: string, base64Data: string) => Promise<DesktopSaveResult>;
      };
    };
  }
}

/**
 * Converts a Blob into a raw base64 string (no `data:...;base64,` prefix)
 * using chunked encoding so large `.docx`/`.xlsx`/`.pptx` files never hit
 * call-stack limits.
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

/**
 * Saves a Blob using the native `pywebview` Save dialog when running inside
 * the desktop wrapper, or falls back to a standard `<a download>` blob link
 * when running in a regular web browser.
 */
export async function saveBlobFile(blob: Blob, filename: string): Promise<SaveFileOutcome> {
  const desktopSave =
    typeof window !== 'undefined' ? window.pywebview?.api?.save_file : undefined;

  if (typeof desktopSave === 'function') {
    const base64Data = await blobToBase64(blob);
    const result = await desktopSave(filename, base64Data);

    if (result?.cancelled) {
      return { saved: false, cancelled: true, method: 'desktop' };
    }

    if (!result?.ok) {
      throw new Error(result?.error || `Could not save "${filename}".`);
    }

    return {
      saved: true,
      path: result.path,
      method: 'desktop'
    };
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return { saved: true, method: 'browser' };
}
