import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { setup, seed } from './support.js';
import { Build } from '../src/domain/models.js';

test('paired original layouts produce Letter PDFs with the original name sizes and inline contacts', async () => {
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
      assert.ok(Math.abs(pdf.getPage(0).getWidth() - 612) < 1);
      assert.ok(Math.abs(pdf.getPage(0).getHeight() - 792) < 1);
      const doc = await getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true }).promise;
      const page = await doc.getPage(1),
        content = await page.getTextContent();
      const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      assert.match(text, /ALEX MORGAN/);
      assert.match(text, /TypeScript/);
      assert.doesNotMatch(text, /\[Company|\[Date|TODO/);
      const annotations = await page.getAnnotations();
      assert.ok(annotations.some((a) => a.url === 'https://example.com/'));
      const name = content.items.find((item) => 'str' in item && item.str.includes('ALEX MORGAN'));
      assert.ok(name && 'height' in name);
      assert.ok(Math.abs(name.height - (stem === 'resume' ? 20 : 18)) < 0.1);
      const email = content.items.find(
        (item) => 'str' in item && item.str.includes('alex.jobs@example.com'),
      );
      const portfolio = content.items.find(
        (item) => 'str' in item && item.str.includes('Portfolio'),
      );
      assert.ok(email && 'transform' in email && portfolio && 'transform' in portfolio);
      assert.ok(
        Math.abs(email.transform[5] - portfolio.transform[5]) < 1,
        'contact details and links must share one row',
      );
      if (stem === 'resume') {
        assert.match(text, /PROFESSIONAL SUMMARY/);
        assert.match(text, /CORE STRENGTHS/);
        assert.match(text, /KEY PROJECTS/);
      }
      await doc.destroy();
      const docx = await s.store.readBytes(
        `artifacts/application-one/${build.revision}/${stem}.docx`,
      );
      assert.equal(Buffer.from(docx).subarray(0, 2).toString(), 'PK');
      assert.match(
        new TextDecoder().decode(
          await s.store.readBytes(`artifacts/application-one/${build.revision}/${stem}.md`),
        ),
        /ALEX MORGAN/,
      );
    }
  } finally {
    await s.cleanup();
  }
});
