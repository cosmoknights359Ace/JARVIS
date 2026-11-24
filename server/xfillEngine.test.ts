import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import {
  buildGroundedPrompt,
  exportFilledDocument,
  generateSampleDocument,
  inspectAndCacheDocument
} from './xfillEngine';
import {
  formatAppendAfterLabel,
  matchEmptyGenericAnswerLabel,
  matchInlineQuestionAndAnswerLabel
} from './xfillParserUtils';

async function buildDocxBuffer(bodyInnerXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyInnerXml}
    <w:sectPr/>
  </w:body>
</w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function buildPptxBuffer(slideBodies: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const slideOverrides = slideBodies
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join('\n  ');
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slideOverrides}
</Types>`
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
  );
  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    ${slideBodies.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('\n    ')}
  </p:sldIdLst>
</p:presentation>`
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slideBodies
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    )
    .join('\n  ')}
</Relationships>`
  );

  slideBodies.forEach((paragraphsXml, i) => {
    zip.file(
      `ppt/slides/slide${i + 1}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Content"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:txBody>
          <a:bodyPr/><a:lstStyle/>
          ${paragraphsXml}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`
    );
  });

  return zip.generateAsync({ type: 'nodebuffer' });
}

test('parser helpers detect A:/Ans:/Answer: prefixes, inline Q&A, and prevent duplicate prefixes', () => {
  assert.deepEqual(matchEmptyGenericAnswerLabel('A:'), { labelPrefix: 'A:', remainder: '' });
  assert.deepEqual(matchEmptyGenericAnswerLabel('Ans:   '), { labelPrefix: 'Ans:', remainder: '' });
  assert.deepEqual(matchEmptyGenericAnswerLabel('Answer: _____'), {
    labelPrefix: 'Answer:',
    remainder: '_____'
  });
  assert.deepEqual(matchEmptyGenericAnswerLabel('A1: [TBD]'), {
    labelPrefix: 'A1:',
    remainder: '[TBD]'
  });
  // Already-filled answer must not be treated as empty
  assert.equal(matchEmptyGenericAnswerLabel('A: Already filled response'), null);

  const inline = matchInlineQuestionAndAnswerLabel('Q1: What is the refund period?\nA:');
  assert.ok(inline);
  assert.equal(inline.question, 'Q1: What is the refund period?');
  assert.equal(inline.answerLabel, 'A:');

  assert.equal(formatAppendAfterLabel('A:', '30 calendar days.'), 'A: 30 calendar days.');
  assert.equal(formatAppendAfterLabel('A:', 'A: 30 calendar days.'), 'A: 30 calendar days.');
  assert.equal(formatAppendAfterLabel('Answer:', 'Answer: Use exponential backoff.'), 'Answer: Use exponential backoff.');
});

test('DOCX inspection detects standalone Q&A with A:/Ans:/Answer:, spacer lines, inline <w:br/>, and writes back cleanly', async () => {
  const docxBuf = await buildDocxBuffer(`
    <w:p><w:r><w:t>Policy Brief: All enterprise refunds must be requested within 30 calendar days.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Q1: What is the enterprise refund window?</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A:</w:t></w:r></w:p>
    <w:p><w:r><w:t>Explain why exponential backoff prevents retry storms.</w:t></w:r></w:p>
    <w:p></w:p>
    <w:p><w:r><w:t>Ans:</w:t></w:r></w:p>
    <w:p><w:r><w:t>Q3: Which protocol guarantees ordered delivery?</w:t></w:r></w:p>
    <w:p><w:r><w:t>Answer: _____</w:t></w:r></w:p>
    <w:p><w:r><w:t>Q4: What is the default HTTPS port?</w:t><w:br/><w:t>A:</w:t></w:r></w:p>
    <w:p><w:r><w:t>Already Answered Q: What is 2+2?</w:t></w:r></w:p>
    <w:p><w:r><w:t>A: 4</w:t></w:r></w:p>
    <w:p><w:r><w:t>System Name: {{assistant}}</w:t></w:r></w:p>
  `);

  const inspected = await inspectAndCacheDocument('policy_qa.docx', docxBuf);
  assert.equal(inspected.slots.length, 5);

  assert.equal(inspected.slots[0].kind, 'question');
  assert.equal(inspected.slots[0].prompt, 'Q1: What is the enterprise refund window?');
  assert.ok(inspected.slots[0].context.includes('30 calendar days'));

  // Spacer paragraph between imperative prompt and "Ans:" must NOT create a duplicate blank slot
  assert.equal(inspected.slots[1].kind, 'question');
  assert.equal(inspected.slots[1].prompt, 'Explain why exponential backoff prevents retry storms.');

  // "Answer: _____" binds to preceding Q3 instead of losing question context
  assert.equal(inspected.slots[2].kind, 'question');
  assert.equal(inspected.slots[2].prompt, 'Q3: Which protocol guarantees ordered delivery?');

  // Inline <w:br/> Q&A binds Q4
  assert.equal(inspected.slots[3].kind, 'question');
  assert.equal(inspected.slots[3].prompt, 'Q4: What is the default HTTPS port?');

  // Existing {{placeholder}} detection remains intact
  assert.equal(inspected.slots[4].kind, 'placeholder');
  assert.ok(inspected.slots[4].prompt.includes('assistant'));

  const exported = await exportFilledDocument(inspected.docId, {
    [inspected.slots[0].id]: '30 calendar days.',
    [inspected.slots[1].id]: 'It spreads out retries over increasing delays.',
    [inspected.slots[2].id]: 'TCP.',
    [inspected.slots[3].id]: '443',
    [inspected.slots[4].id]: 'J.A.R.V.I.S'
  });

  const outZip = await JSZip.loadAsync(exported.buffer);
  const outXml = await outZip.file('word/document.xml')!.async('string');

  // Formatting (<w:rPr><w:b/></w:rPr>) and label prefixes preserved cleanly
  assert.ok(outXml.includes('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">A: 30 calendar days.</w:t>'));
  assert.ok(outXml.includes('Ans: It spreads out retries over increasing delays.'));
  assert.ok(outXml.includes('Answer: TCP.'));
  assert.ok(!outXml.includes('Answer: _____'));
  // Inline <w:br/> preserved with answer written cleanly after trailing A:
  assert.ok(outXml.includes('<w:t>Q4: What is the default HTTPS port?</w:t><w:br/><w:t xml:space="preserve">A: 443</w:t>'));
  assert.ok(outXml.includes('System Name: J.A.R.V.I.S'));
  // Already-answered Q&A remained untouched
  assert.ok(outXml.includes('<w:t>A: 4</w:t>'));
});

test('DOCX two-column Q:/A: table binds preceding row question to empty answer cell without duplicating label cell', async () => {
  const docxBuf = await buildDocxBuffer(`
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Q:</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>What is the retention window for audit logs?</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>A:</w:t></w:r></w:p></w:tc>
        <w:tc><w:p></w:p></w:tc>
      </w:tr>
    </w:tbl>
  `);

  const inspected = await inspectAndCacheDocument('table_qa.docx', docxBuf);
  assert.equal(inspected.slots.length, 1);
  assert.equal(inspected.slots[0].location, 'Table 1 · Row 2, Col 2');
  assert.equal(inspected.slots[0].prompt, 'What is the retention window for audit logs?');
});

test('XLSX inspection detects vertical A:/Ans: rows, two-column Q:/A: pairs, and multi-line cells without breaking tables', async () => {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: single-column vertical Q&A with A: / Ans:
  const s1 = wb.addWorksheet('Vertical_QA');
  s1.addRow(['Background: Project Orion launches on October 15.']);
  s1.addRow(['Q1: When does Project Orion launch?']);
  s1.addRow(['A:']);
  s1.addRow(['Describe the fallback strategy.']);
  s1.addRow(['Ans:']);
  s1.addRow(['Q3: What is the primary port?\nA:']);

  // Sheet 2: two-column Q:/A: layout
  const s2 = wb.addWorksheet('TwoCol_QA');
  s2.addRow(['Q:', 'Which database stores embeddings?']);
  s2.addRow(['A:', '']);

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const inspected = await inspectAndCacheDocument('qa_sheet.xlsx', buf);
  assert.equal(inspected.slots.length, 4);

  assert.equal(inspected.slots[0].location, 'Vertical_QA!A3');
  assert.equal(inspected.slots[0].prompt, 'Q1: When does Project Orion launch?');

  assert.equal(inspected.slots[1].location, 'Vertical_QA!A5');
  assert.equal(inspected.slots[1].prompt, 'Describe the fallback strategy.');

  assert.equal(inspected.slots[2].location, 'Vertical_QA!A6');
  assert.equal(inspected.slots[2].prompt, 'Q3: What is the primary port?');

  assert.equal(inspected.slots[3].location, 'TwoCol_QA!B2');
  assert.equal(inspected.slots[3].prompt, 'Which database stores embeddings?');

  const exported = await exportFilledDocument(inspected.docId, {
    [inspected.slots[0].id]: 'October 15.',
    [inspected.slots[1].id]: 'Fall back to cached responses.',
    [inspected.slots[2].id]: '3000',
    [inspected.slots[3].id]: 'PostgreSQL with pgvector.'
  });

  const outWb = new ExcelJS.Workbook();
  await outWb.xlsx.load(exported.buffer as any);
  assert.equal(outWb.getWorksheet('Vertical_QA')!.getCell('A3').value, 'A: October 15.');
  assert.equal(
    outWb.getWorksheet('Vertical_QA')!.getCell('A5').value,
    'Ans: Fall back to cached responses.'
  );
  assert.equal(
    outWb.getWorksheet('Vertical_QA')!.getCell('A6').value,
    'Q3: What is the primary port?\nA: 3000'
  );
  assert.equal(
    outWb.getWorksheet('TwoCol_QA')!.getCell('B2').value,
    'PostgreSQL with pgvector.'
  );
});

test('PPTX inspection detects standalone A:/Ans:/Answer: fields with bound questions and preserves slide XML formatting', async () => {
  const pptxBuf = await buildPptxBuffer([
    `
      <a:p><a:r><a:rPr lang="en-US" sz="2000" b="1"/><a:t>Q1: Why use local inference?</a:t></a:r></a:p>
      <a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>A:</a:t></a:r></a:p>
      <a:p><a:r><a:t>Summarize our caching policy.</a:t></a:r></a:p>
      <a:p><a:r><a:t>Ans: _____</a:t></a:r></a:p>
      <a:p><a:r><a:t>Owner: {{owner}}</a:t></a:r></a:p>
    `
  ]);

  const inspected = await inspectAndCacheDocument('review.pptx', pptxBuf);
  assert.equal(inspected.slots.length, 3);
  assert.equal(inspected.slots[0].prompt, 'Q1: Why use local inference?');
  assert.equal(inspected.slots[1].prompt, 'Summarize our caching policy.');
  assert.equal(inspected.slots[2].kind, 'placeholder');

  const exported = await exportFilledDocument(inspected.docId, {
    [inspected.slots[0].id]: 'Keeps private data offline.',
    [inspected.slots[1].id]: 'LRU cache with 30-minute TTL.',
    [inspected.slots[2].id]: 'Platform Team'
  });

  const outZip = await JSZip.loadAsync(exported.buffer);
  const slideXml = await outZip.file('ppt/slides/slide1.xml')!.async('string');
  assert.ok(slideXml.includes('<a:rPr lang="en-US" sz="1800"/><a:t>A: Keeps private data offline.</a:t>'));
  assert.ok(slideXml.includes('Ans: LRU cache with 30-minute TTL.'));
  assert.ok(slideXml.includes('Owner: Platform Team'));
});

test('built-in DOCX, XLSX, and PPTX sample templates keep full field detection intact', async () => {
  const docxSample = await generateSampleDocument('docx');
  const docxRes = await inspectAndCacheDocument(docxSample.fileName, docxSample.buffer);
  assert.equal(docxRes.slots.length, 6);

  const xlsxSample = await generateSampleDocument('xlsx');
  const xlsxRes = await inspectAndCacheDocument(xlsxSample.fileName, xlsxSample.buffer);
  assert.equal(xlsxRes.slots.length, 6);

  const pptxSample = await generateSampleDocument('pptx');
  const pptxRes = await inspectAndCacheDocument(pptxSample.fileName, pptxSample.buffer);
  assert.equal(pptxRes.slots.length, 6);
});

test('buildGroundedPrompt includes extracted DOCUMENT_CONTENT so local models solve Q&A from document text', () => {
  const prompt = buildGroundedPrompt(
    [
      {
        id: 'slot_1',
        location: 'Paragraph 3',
        kind: 'question',
        prompt: 'What is the refund window?',
        context: 'Policy Brief | Q1: What is the refund window? | A:'
      }
    ],
    {
      memory: {},
      contextNotes: '',
      strictGrounding: true,
      answerStyle: 'concise',
      customInstructions: '',
      modelName: 'vai-doc:latest',
      ollamaHost: 'http://127.0.0.1:11434',
      keepAliveMinutes: 30
    },
    'Policy Brief: Refunds are honored within 30 calendar days of purchase.'
  );

  assert.ok(prompt.system.includes('DOCUMENT_CONTENT'));
  assert.ok(prompt.user.includes('Refunds are honored within 30 calendar days of purchase.'));
});
