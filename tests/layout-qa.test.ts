import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { setup, seed } from './support.js';
import { Profile, Draft, type Fact } from '../src/domain/models.js';
import { documentModel } from '../src/domain/documents.js';
import { Renderer } from '../src/adapters/renderer.js';

interface LayoutCase {
  name: string;
  applicantName: string;
  experienceCount: number;
  longLink: boolean;
  minimumResumePages: number;
}
const cases = JSON.parse(
  await readFile(new URL('./fixtures/layout-cases.json', import.meta.url), 'utf8'),
) as LayoutCase[];

test('layout regression fixtures keep long names, extensive experience, and long links within the printable page', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const c = await s.kit.context('application-one');
    for (const fixture of cases) {
      const facts: Fact[] = c.profile.facts.filter((fact) => fact.kind !== 'experience');
      for (let index = 0; index < fixture.experienceCount; index++)
        facts.push({
          id: `experience-${index}`,
          kind: 'experience',
          verified: true,
          text: `Software Engineer: Example Team ${index + 1}`,
          dates: '2022 to 2025',
          context: 'Internal reporting and operational tools',
          bullets: [
            'Built and maintained reporting services with TypeScript and PostgreSQL for internal operations teams.',
            'Tested API integrations and documented service behavior for colleagues responsible for support.',
            'Improved the reliability of data workflows through validation and clear error handling.',
          ],
        });
      const profile = Profile.parse({
        ...c.profile,
        name: fixture.applicantName,
        facts,
        contact: {
          ...c.profile.contact,
          links: fixture.longLink
            ? [
                {
                  label:
                    'Portfolio and selected professional projects with detailed implementation notes',
                  url: 'https://example.com/' + 'long-portfolio-path/'.repeat(8),
                },
              ]
            : c.profile.contact.links,
        },
      });
      const draft = Draft.parse({
        ...c.draft,
        factIds: facts.map((f) => f.id),
        coverLetter: [
          {
            text: 'I build TypeScript services and practical internal tools.',
            evidence: ['backend'],
          },
        ],
      });
      const output = await new Renderer().render(documentModel(profile, draft, c.job, c.company));
      assert.ok(output.pages.resume >= fixture.minimumResumePages, fixture.name);
      for (const stem of ['resume', 'cover-letter']) {
        const pdf = await getDocument({ data: Uint8Array.from(output.files[`${stem}.pdf`]!) })
          .promise;
        let extracted = '';
        for (let number = 1; number <= pdf.numPages; number++) {
          const page = await pdf.getPage(number);
          const text = await page.getTextContent();
          const viewport = page.getViewport({ scale: 1 });
          for (const item of text.items)
            if ('str' in item && item.str.trim()) {
              extracted += item.str + ' ';
              assert.ok(
                item.transform[4] >= 35 && item.transform[4] + item.width <= viewport.width - 35,
                `${fixture.name}: ${stem} text exceeds horizontal print bounds: ${item.str}`,
              );
              assert.ok(
                item.transform[5] > 20 && item.transform[5] < viewport.height - 20,
                `${fixture.name}: ${stem} text exceeds vertical print bounds`,
              );
            }
        }
        assert.ok(extracted.includes(fixture.applicantName.toUpperCase()), fixture.name);
        if (stem === 'resume')
          assert.ok(
            extracted.includes(`Example Team ${fixture.experienceCount}`),
            'The final experience entry must not be dropped',
          );
        await pdf.destroy();
      }
    }
  } finally {
    await s.cleanup();
  }
});

test(
  'optional Word pagination uses independent conversion and retains reviewable PDFs',
  { skip: !process.env.APPLYKIT_TEST_WORD },
  async () => {
    const s = await setup(true);
    try {
      await seed(s.kit);
      const result = await s.kit.build('application-one', false, true);
      assert.ok(result.build.wordPages && result.build.wordPages.resume >= 1);
      for (const stem of ['resume', 'cover-letter']) {
        const bytes = await s.store.readBytes(
          `artifacts/application-one/${result.build.revision}/${stem}.word-preview.pdf`,
        );
        assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 1);
        assert.ok(result.build.files[`${stem}.word-preview.pdf`]);
      }
    } finally {
      await s.cleanup();
    }
  },
);
