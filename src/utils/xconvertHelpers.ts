/**
 * Pure frontend helpers for Xconvert queue formatting, batch target detection,
 * and missing-engine hint resolution.
 */

export type XconvertCategory =
  | 'image'
  | 'document'
  | 'data'
  | 'media'
  | 'archive'
  | 'unsupported';

export interface XconvertQueueItem {
  id: string;
  path: string;
  name: string;
  ext: string;
  sizeBytes: number;
  category: XconvertCategory;
  compatibleTargets: string[];
  targetFormat: string;
  status: 'pending' | 'converting' | 'done' | 'error';
  outputPath?: string;
  error?: string;
  durationMs?: number;
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function getDefaultTargetFormat(
  ext: string,
  compatibleTargets: string[]
): string {
  if (!Array.isArray(compatibleTargets) || compatibleTargets.length === 0) {
    return '';
  }
  const clean = (ext || '').trim().toLowerCase();
  const preferredMap: Record<string, string[]> = {
    png: ['jpg', 'webp', 'pdf'],
    jpg: ['png', 'webp', 'pdf'],
    jpeg: ['png', 'webp', 'pdf'],
    webp: ['png', 'jpg'],
    bmp: ['png', 'jpg'],
    tiff: ['png', 'pdf'],
    gif: ['webp', 'png'],
    ico: ['png'],
    pdf: ['docx', 'txt'],
    docx: ['pdf', 'txt'],
    md: ['html', 'pdf', 'docx'],
    html: ['pdf', 'md', 'txt'],
    txt: ['pdf', 'md', 'html'],
    csv: ['xlsx', 'json'],
    xlsx: ['csv', 'json'],
    json: ['csv', 'yaml'],
    yaml: ['json', 'csv'],
    yml: ['json', 'csv'],
    xml: ['json', 'csv'],
    mp4: ['mp3', 'mkv', 'gif'],
    mkv: ['mp4', 'mp3'],
    mov: ['mp4', 'mp3'],
    avi: ['mp4', 'mp3'],
    webm: ['mp4', 'mp3'],
    mp3: ['wav', 'flac'],
    wav: ['mp3', 'flac'],
    flac: ['mp3', 'wav'],
    ogg: ['mp3', 'wav'],
    m4a: ['mp3', 'wav'],
    zip: ['tar.gz', 'tar'],
    tar: ['zip', 'tar.gz'],
    'tar.gz': ['zip', 'tar'],
    '7z': ['zip', 'tar.gz']
  };

  for (const pref of preferredMap[clean] || []) {
    if (compatibleTargets.includes(pref)) return pref;
  }
  return compatibleTargets[0];
}

/**
 * Returns shared category and common compatible targets when all queued items
 * share a single supported category (enabling the "Set All To..." batch selector).
 */
export function getSharedCategoryBatchTargets(
  items: Pick<XconvertQueueItem, 'category' | 'compatibleTargets'>[]
): { category: XconvertCategory; targets: string[] } | null {
  if (items.length === 0) return null;
  const firstCat = items[0].category;
  if (firstCat === 'unsupported') return null;

  for (const item of items) {
    if (item.category !== firstCat) return null;
  }

  let shared = [...items[0].compatibleTargets];
  for (let i = 1; i < items.length; i++) {
    const allowed = new Set(items[i].compatibleTargets);
    shared = shared.filter((t) => allowed.has(t));
  }

  if (shared.length === 0) return null;
  return { category: firstCat, targets: shared };
}

/**
 * Returns the specific `pip install ...` hint only if a queued file's conversion
 * requires a Python engine reported as missing by `xconvert_capabilities()`.
 */
export function getRequiredMissingEngineHint(
  items: Pick<XconvertQueueItem, 'ext' | 'category' | 'targetFormat'>[],
  engines: Record<string, boolean> | null
): string | null {
  if (!engines || items.length === 0) return null;

  const missingPip = new Set<string>();
  const requireEngine = (mod: string, pipName: string) => {
    if (engines[mod] === false) {
      missingPip.add(pipName);
    }
  };

  for (const item of items) {
    const src = item.ext.toLowerCase();
    const dst = item.targetFormat.toLowerCase();

    if (item.category === 'image') {
      requireEngine('PIL', 'Pillow');
      if (dst === 'pdf') requireEngine('img2pdf', 'img2pdf');
    } else if (item.category === 'document') {
      if (src === 'pdf' && dst === 'docx') {
        requireEngine('pdf2docx', 'pdf2docx');
      } else if (src === 'pdf' || dst === 'pdf') {
        requireEngine('fitz', 'PyMuPDF');
      }
      if (src === 'docx' || dst === 'docx') {
        requireEngine('docx', 'python-docx');
      }
      if (src === 'md' && dst === 'html') {
        requireEngine('markdown', 'markdown');
      }
    } else if (item.category === 'data') {
      if (src === 'xlsx' || dst === 'xlsx') {
        requireEngine('openpyxl', 'openpyxl');
      }
      if (src === 'yaml' || src === 'yml' || dst === 'yaml' || dst === 'yml') {
        requireEngine('yaml', 'PyYAML');
      }
    } else if (item.category === 'media') {
      requireEngine('imageio_ffmpeg', 'imageio-ffmpeg');
    } else if (item.category === 'archive') {
      if (src === '7z' || dst === '7z') {
        requireEngine('py7zr', 'py7zr');
      }
    }
  }

  if (missingPip.size === 0) return null;
  return `pip install ${Array.from(missingPip).join(' ')}`;
}
