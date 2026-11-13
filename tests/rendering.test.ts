import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { setup, seed } from './support.js';
import { Build } from '../src/domain/models.js';

test('fictional profile produces A4 selectable-text PDFs, DOCX, Markdown and working links', async () => {
  const s = await setup(true);
  try {
    await seed(s.kit);
    const build = await s.store.read('applications/application-one/build.json', Build);
    assert.equal(build.pages.resume, 1);
    assert.equal(build.pages.coverLetter, 1);
    for (const stem of ['resume', 'cover-letter']) {
      const bytes = await s.store.readBytes(
        `artifacts/application-one/${build.revision}/${stem}.pdf`,
      );
      const pdf = await PDFDocument.load(bytes);
      assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.28) < 2);
      const doc = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
      const page = await doc.getPage(1),
        content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      assert.match(text, /Alex Morgan/);
      assert.match(text, /TypeScript/);
      assert.doesNotMatch(text, /\[Company|\[Date|TODO/);
      const annotations = await page.getAnnotations();
      assert.ok(annotations.some((a) => a.url === 'https://example.com/'));
      await doc.destroy();
      const docx = await s.store.readBytes(
        `artifacts/application-one/${build.revision}/${stem}.docx`,
      );
      assert.equal(Buffer.from(docx).subarray(0, 2).toString(), 'PK');
      assert.match(
        new TextDecoder().decode(
          await s.store.readBytes(`artifacts/application-one/${build.revision}/${stem}.md`),
        ),
        /Alex Morgan/,
      );
    }
  } finally {
    await s.cleanup();
  }
});
