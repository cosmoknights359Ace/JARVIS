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
