import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTargetSlideCount,
  validateDeckJson,
  normalizeSlideItem,
  extractSlideTable
} from './slidesUtils';
import { exportDeckToPptx } from './slidesEngine';
import JSZip from 'jszip';

test('resolveTargetSlideCount overrides preset when prompt specifies a slide count', () => {
  assert.deepEqual(
    resolveTargetSlideCount('Create a 6-slide presentation on B-Trees vs LSM-Trees', 8),
    { count: 6, overridden: true }
  );
  assert.deepEqual(
    resolveTargetSlideCount('Make 4 slides about CAP theorem with a comparison table', 8),
    { count: 4, overridden: true }
  );
  assert.deepEqual(
    resolveTargetSlideCount('Build a deck of 10 slides on Kubernetes scheduling', 8),
    { count: 10, overridden: true }
  );
  // Must NOT falsely override on unrelated numbers like HTTP 429 or Python 3
  assert.deepEqual(
    resolveTargetSlideCount('Handling HTTP 429 rate limits in Python 3 services', 8),
    { count: 8, overridden: false }
  );
});

test('validateDeckJson catches slide count mismatches, placeholder copy, missing notes, and bad tables', () => {
  const badCount = validateDeckJson(
    {
      title: 'Test',
      slides: [
        { type: 'title', title: 'Intro', subtitle: 'Sub', speaker_notes: 'Detailed intro talking points.' }
      ]
    },
    3
  );
  assert.equal(badCount.valid, false);
  assert.ok(badCount.issues.some((i) => i.includes('Expected exactly 3 slides')));

  const placeholderAndMissingNotes = validateDeckJson(
    {
      title: 'Test',
      slides: [
        { type: 'title', title: 'Intro', subtitle: 'Sub', speaker_notes: 'Opening overview of the technical talk.' },
        { type: 'bullets', title: 'Details', bullets: ['Core insights on Details.'], speaker_notes: '' },
        { type: 'table', title: 'Compare', headers: ['OnlyOne'], rows: [], speaker_notes: 'Compare approaches.' }
      ]
    },
    3
  );
  assert.equal(placeholderAndMissingNotes.valid, false);
  assert.ok(placeholderAndMissingNotes.issues.some((i) => i.includes('no real bullet points')));
  assert.ok(placeholderAndMissingNotes.issues.some((i) => i.includes('missing concrete speaker_notes')));
  assert.ok(placeholderAndMissingNotes.issues.some((i) => i.includes('table layout')));
});

test('validateDeckJson and normalizeSlideItem accept valid table slides and speaker_notes', () => {
  const validPayload = {
    title: 'Storage Engines',
    slides: [
      {
        type: 'title',
        title: 'B-Trees vs LSM-Trees',
        subtitle: 'Read/Write Amplification Trade-Offs',
        speaker_notes: 'Introduce B-Tree and LSM-Tree storage engines and why write patterns dictate index choice.'
      },
      {
        type: 'table',
        title: 'Complexity Comparison',
        headers: ['Operation', 'B-Tree', 'LSM-Tree'],
        rows: [
          ['Point Lookup', 'O(log_B N)', 'O(L * log N) w/ Bloom filters'],
          ['Sequential Write', 'In-place random I/O', 'O(1) append to WAL + MemTable']
        ],
        speaker_notes: 'Walk through the exact Big-O bounds and explain how Bloom filters cut LSM read amplification.'
      }
    ]
  };

  assert.equal(validateDeckJson(validPayload, 2).valid, true);
  const tableSlide = normalizeSlideItem(validPayload.slides[1], 1, 'Storage Engines');
  assert.equal(tableSlide.layout, 'table');
  assert.deepEqual(tableSlide.table?.headers, ['Operation', 'B-Tree', 'LSM-Tree']);
  assert.equal(tableSlide.table?.rows.length, 2);
  assert.ok(tableSlide.speakerNotes.includes('Bloom filters'));
});

test('extractSlideTable supports both nested table object and top-level headers/rows', () => {
  const nested = extractSlideTable({
    table: { headers: ['A', 'B'], rows: [['1', '2']] }
  });
  assert.deepEqual(nested, { headers: ['A', 'B'], rows: [['1', '2']] });

  const flat = extractSlideTable({
    headers: ['Metric', 'Value'],
    rows: [['Latency', '12ms']]
  });
  assert.deepEqual(flat, { headers: ['Metric', 'Value'], rows: [['Latency', '12ms']] });
});

test('exportDeckToPptx compiles table slides and embeds speaker notes into PowerPoint notesSlides', async () => {
  const deck = {
    id: 'deck_test_1',
    title: 'Storage Engines',
    subtitle: 'Technical Trade-Offs',
    topic: 'B-Trees vs LSM-Trees',
    themeId: 'obsidian-orange' as const,
    audience: 'technical' as const,
    provider: 'ollama' as const,
    model: 'vai-doc:latest',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slides: [
      {
        id: 's1',
        layout: 'title' as const,
        kicker: 'Architecture',
        title: 'B-Trees vs LSM-Trees',
        subtitle: 'Disk-resident index structures',
        bullets: [],
        speakerNotes: 'Speaker Note Alpha: Explain page-oriented vs log-structured storage.',
        imageQuery: 'database architecture diagram',
        image: null
      },
      {
        id: 's2',
        layout: 'table' as const,
        kicker: 'Comparison',
        title: 'Performance Bounds',
        bullets: [],
        table: {
          headers: ['Property', 'B-Tree', 'LSM-Tree'],
          rows: [
            ['Write Path', 'In-place 4KB page update', 'Sequential WAL + MemTable flush'],
            ['Read Path', 'Single tree traversal O(log_B N)', 'MemTable + SSTable levels']
          ]
        },
        speakerNotes: 'Speaker Note Beta: Highlight write amplification vs read amplification.',
        imageQuery: 'storage engine comparison',
        image: null
      }
    ]
  };

  const exported = await exportDeckToPptx(deck);
  assert.ok(exported.buffer.length > 5000);

  const zip = await JSZip.loadAsync(exported.buffer);
  const slide2Xml = await zip.file('ppt/slides/slide2.xml')?.async('string');
  assert.ok(slide2Xml && slide2Xml.includes('<a:tbl>'), 'Slide 2 XML must contain a native PowerPoint table (<a:tbl>)');
  assert.ok(slide2Xml.includes('Sequential WAL + MemTable flush'));

  const notes2Xml = await zip.file('ppt/notesSlides/notesSlide2.xml')?.async('string');
  assert.ok(
    notes2Xml && notes2Xml.includes('Speaker Note Beta: Highlight write amplification'),
    'Slide 2 must embed speaker notes in PowerPoint notesSlide XML'
  );
});

test('normalizeSlideItem promotes eyebrow/kicker/subtitle when model emits generic numbered titles like "Slide 2"', () => {
  const fromKicker = normalizeSlideItem(
    {
      layout: 'bullets',
      kicker: 'Memory Architecture & Caching',
      title: 'Slide 2',
      bullets: ['L1 cache holds hot vectors', 'Pinned pages avoid disk thrashing'],
      speaker_notes: 'Slide 2: Explain how the multi-tier cache minimizes tail latency.'
    },
    1,
    'Local LLM Serving'
  );
  assert.equal(fromKicker.title, 'Memory Architecture & Caching');
  assert.equal(fromKicker.kicker, '');
  assert.equal(
    fromKicker.speakerNotes,
    'Explain how the multi-tier cache minimizes tail latency.'
  );

  const fromEyebrow = normalizeSlideItem(
    {
      layout: 'bullets',
      eyebrow: 'Quantization Trade-Offs',
      title: 'Page 3:',
      bullets: ['Q4_K_M cuts VRAM by ~70%'],
      speaker_notes: 'Page 3 - Compare perplexity loss across quantization tiers'
    },
    2,
    'Local LLM Serving'
  );
  assert.equal(fromEyebrow.title, 'Quantization Trade-Offs');
  assert.equal(fromEyebrow.kicker, '');
  assert.equal(
    fromEyebrow.speakerNotes,
    'Compare perplexity loss across quantization tiers.'
  );

  const fromSubtitle = normalizeSlideItem(
    {
      layout: 'bullets',
      kicker: 'Section 04',
      title: 'Slide 4 - ',
      subtitle: 'Deterministic Parser Safeguards',
      bullets: ['Validates JSON before rendering'],
      speaker_notes: 'Slide 4: • Validates JSON before rendering\n• Prevents malformed XML output'
    },
    3,
    'Local LLM Serving'
  );
  assert.equal(fromSubtitle.title, 'Deterministic Parser Safeguards');
  assert.equal(fromSubtitle.subtitle, undefined);
  assert.equal(
    fromSubtitle.speakerNotes,
    'Validates JSON before rendering. Prevents malformed XML output.'
  );
});

test('normalizeSlideItem enforces short 1-3 word kickers and validateDeckJson flags generic titles and Slide N: notes', () => {
  const longKickerSlide = normalizeSlideItem(
    {
      layout: 'bullets',
      kicker: 'Deep Dive Into Distributed Consensus Protocols',
      title: 'Raft Leader Election Mechanics',
      bullets: ['Randomized election timeouts prevent split votes'],
      speaker_notes: 'Walk through how randomized timers keep leader election converging quickly.'
    },
    1,
    'Distributed Consensus'
  );
  assert.equal(longKickerSlide.title, 'Raft Leader Election Mechanics');
  assert.ok(longKickerSlide.kicker.split(/\s+/).length <= 3);

  const validation = validateDeckJson(
    {
      title: 'Storage Engines',
      slides: [
        {
          layout: 'title',
          title: 'Storage Engines Overview',
          subtitle: 'B-Trees vs LSM-Trees',
          speaker_notes: 'Introduce the storage trade-offs between read-optimized and write-optimized engines.'
        },
        {
          layout: 'bullets',
          kicker: 'Write Path Architecture',
          title: 'Slide 2',
          bullets: ['Sequential WAL append ensures durability'],
          speaker_notes: 'Slide 2: Sequential WAL append ensures durability across crashes.'
        }
      ]
    },
    2
  );
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((i) => i.includes('descriptive 3-7 word title')));
  assert.ok(validation.issues.some((i) => i.includes('without a "Slide 2:" prefix')));
});

test('two_column comparison headers and key_takeaway layout normalize, validate, and export to PPTX cleanly', async () => {
  const rawDeck = {
    title: 'Local AI Architecture',
    slides: [
      {
        layout: 'title',
        title: 'Local AI Architecture',
        subtitle: 'Privacy-First Desktop Inference',
        speaker_notes: 'Open with why running local quantized models matters for private desktop workflows.'
      },
      {
        layout: 'two_column',
        kicker: 'Trade-Offs',
        title: 'Local 3B vs Cloud Inference',
        leftTitle: 'Local 3B (Ollama)',
        rightTitle: 'Cloud API Fallback',
        bullets: ['Zero data leaves disk', 'Sub-50ms LAN/loopback latency'],
        secondaryBullets: ['Higher parameter reasoning depth', 'Requires API connectivity'],
        speaker_notes: 'Contrast local 3B latency and privacy benefits against cloud reasoning capacity.'
      },
      {
        layout: 'key_takeaway',
        kicker: 'Summary',
        title: 'Adopt Hybrid Local-First Defaults',
        takeaway: 'Keep 3B models warm locally for instant privacy-preserving workflows and cap 7B context windows to 2048 on 4 GB GPUs.',
        bullets: [
          'Pre-warm qwen2.5:3b silently at boot',
          'Cap 7B+ num_ctx to 2048 tokens',
          'Escalate to cloud only on explicit fallback'
        ],
        speaker_notes: 'Close by reinforcing the hybrid guardrail strategy and next implementation steps.'
      }
    ]
  };

  const check = validateDeckJson(rawDeck, 3);
  assert.equal(check.valid, true, `Unexpected validation issues: ${check.issues.join('; ')}`);

  const slides = rawDeck.slides.map((s, idx) => normalizeSlideItem(s, idx, 'Local AI Architecture'));
  assert.equal(slides[1].layout, 'two_column');
  assert.equal(slides[1].leftTitle, 'Local 3B (Ollama)');
  assert.equal(slides[1].rightTitle, 'Cloud API Fallback');
  assert.equal(slides[2].layout, 'key_takeaway');
  assert.ok(slides[2].takeaway?.includes('cap 7B context windows to 2048'));

  const exported = await exportDeckToPptx({
    id: 'deck_layouts_test',
    title: 'Local AI Architecture',
    subtitle: 'Privacy-First Desktop Inference',
    topic: 'Local AI Architecture',
    themeId: 'obsidian-orange',
    audience: 'technical',
    provider: 'ollama',
    model: 'vai-doc:latest',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    slides
  });

  const zip = await JSZip.loadAsync(exported.buffer);
  const slide2Xml = await zip.file('ppt/slides/slide2.xml')?.async('string');
  const slide3Xml = await zip.file('ppt/slides/slide3.xml')?.async('string');
  assert.ok(slide2Xml?.includes('Local 3B (Ollama)'));
  assert.ok(slide2Xml?.includes('Cloud API Fallback'));
  assert.ok(slide3Xml?.includes('KEY TAKEAWAY'));
  assert.ok(slide3Xml?.includes('Pre-warm qwen2.5:3b silently at boot'));
});


