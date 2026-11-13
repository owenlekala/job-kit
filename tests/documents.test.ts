import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { Packer } from 'docx';
import { Draft, Profile, validateEvidence } from '../src/domain/models.js';
import { documentModel } from '../src/domain/documents.js';
import { startingDraft } from '../src/domain/drafting.js';
import { buildResume } from '../src/adapters/documents/resume_build.js';
import { buildCoverLetter } from '../src/adapters/documents/cover_letter.js';
import { loadFonts } from '../src/adapters/documents/fonts.js';
import { setup, seed } from './support.js';

const paragraphs = (xml: string) => xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
const plain = (xml: string) =>
  Array.from(xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g), (m) => m[1]).join('');
const attributes = (xml: string, tag: string) => {
  const match = xml.match(new RegExp(`<${tag}\\b([^>]*)>`));
  assert.ok(match, `Missing ${tag}`);
  return Object.fromEntries(
    Array.from(match[1]!.matchAll(/([\w:]+)="([^"]*)"/g), (m) => [m[1], m[2]]),
  );
};

test('Word templates retain the original scripts’ measurements and document blocks', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const c = await s.kit.context('application-one');
    c.draft.recipient = {
      hiringManager: 'Jordan Lee',
      addressLines: ['100 Example Road', 'Cape Town'],
    };
    const model = documentModel(c.profile, c.draft, c.job, c.company);
    for (const letter of [false, true]) {
      const zip = await JSZip.loadAsync(
        await Packer.toBuffer(letter ? buildCoverLetter(model) : buildResume(model)),
      );
      const xml = await zip.file('word/document.xml')!.async('string'),
        ps = paragraphs(xml);
      const page = attributes(xml, 'w:pgSz'),
        margin = attributes(xml, 'w:pgMar');
      assert.equal(page['w:w'], '12240');
      assert.equal(page['w:h'], '15840');
      assert.equal(margin['w:top'], '720');
      assert.equal(margin['w:bottom'], '720');
      assert.equal(margin['w:left'], letter ? '1080' : '900');
      assert.equal(margin['w:right'], letter ? '1080' : '900');
      assert.equal(plain(ps[0]!), 'ALEX MORGAN');
      assert.equal(attributes(ps[0]!, 'w:sz')['w:val'], letter ? '36' : '40');
      assert.equal(attributes(ps[0]!, 'w:spacing')['w:after'], '40');
      assert.equal(attributes(ps[0]!, 'w:color')['w:val'], '1F2937');
      assert.equal(attributes(ps[0]!, 'w:rFonts')['w:ascii'], 'Calibri');
      assert.match(plain(ps[2]!), /alex.jobs@example.com.*Portfolio/);
      assert.equal(attributes(ps[2]!, 'w:spacing')['w:after'], letter ? '400' : '200');
      assert.doesNotMatch(xml, /<w:tbl\b/);
      if (letter) {
        assert.ok(plain(ps[3]!).match(/^\d{4}-\d{2}-\d{2}$/));
        assert.ok(ps.some((p) => plain(p) === 'Jordan Lee'));
        assert.ok(ps.some((p) => plain(p) === 'Dear Jordan Lee,'));
        assert.equal(plain(ps.at(-2)!), 'Yours sincerely,');
        assert.equal(plain(ps.at(-1)!), 'Alex Morgan');
      } else {
        const headings = ps.filter((p) => /<w:pBdr>/.test(p));
        assert.deepEqual(headings.map(plain), [
          'PROFESSIONAL SUMMARY',
          'TECHNICAL SKILLS',
          'CORE STRENGTHS',
          'PROFESSIONAL EXPERIENCE',
          'KEY PROJECTS',
          'EDUCATION',
        ]);
        assert.equal(attributes(headings[0]!, 'w:bottom')['w:sz'], '6');
        assert.equal(attributes(headings[0]!, 'w:spacing')['w:before'], '280');
        const job = ps.find((p) => plain(p).includes('Software Engineer — Example Studio'))!;
        assert.match(job, /<w:tab w:val="right" w:pos="9360"/);
        assert.match(job, /<w:tab\/>/);
        assert.match(job, /2022–2025/);
        assert.ok(
          ps.some((p) => plain(p).includes('Internal business software') && /<w:i\b/.test(p)),
        );
        assert.ok(ps.some((p) => plain(p).includes('Example University') && /<w:i\b/.test(p)));
        assert.match(
          await zip.file('word/_rels/document.xml.rels')!.async('string'),
          /https:\/\/example.com\/inventory/,
        );
      }
    }
  } finally {
    await s.cleanup();
  }
});

test('flat facts remain compatible and structured text is neither dropped nor unverified', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const c = await s.kit.context('application-one');
    const profile = Profile.parse({
      ...c.profile,
      facts: [
        {
          id: 'legacy',
          kind: 'experience',
          text: 'Original title\nOriginal responsibility',
          bullets: ['Additional verified responsibility'],
          verified: true,
        },
      ],
    });
    const draft = Draft.parse({
      ...c.draft,
      factIds: ['legacy'],
      coverLetter: [{ text: 'I have performed related work.', evidence: ['legacy'] }],
      email: {
        subject: 'Application',
        paragraphs: [{ text: 'Related work', evidence: ['legacy'] }],
      },
    });
    const model = documentModel(profile, draft, c.job, c.company),
      entry = model.sections[0]!.entries[0]!;
    assert.equal(entry.type, 'experience');
    if (entry.type === 'experience')
      assert.deepEqual(entry.bullets, [
        'Original responsibility',
        'Additional verified responsibility',
      ]);
    const bad = Profile.parse({
      ...profile,
      facts: [{ ...profile.facts[0], bullets: ['[Company Name]'] }],
    });
    assert.throws(() => validateEvidence(bad, draft), /placeholder/);
    assert.throws(() =>
      Profile.parse({
        ...profile,
        facts: [
          { id: 'wrong-fields', kind: 'skill', text: 'Node.js', dates: '2020', verified: true },
        ],
      }),
    );
  } finally {
    await s.cleanup();
  }
});

test('starting letters show verified capabilities without adopting the role’s seniority or tools', async () => {
  const s = await setup();
  try {
    await seed(s.kit);
    const c = await s.kit.context('application-one');
    const job = {
      ...c.job,
      title: 'Senior Python Engineer',
      description: 'Build Python APIs and Django services using relational databases.',
    };
    const draft = startingDraft(c.profile, job, c.company, ['backend', 'delivery'], '2026-11-13');
    assert.equal(draft.headline, 'Software Engineer');
    assert.equal(draft.coverLetter.length, 4);
    const body = draft.coverLetter.map((p) => p.text).join('\n');
    assert.match(body, /TypeScript/);
    assert.match(body, /I built and maintained internal reporting services/);
    assert.match(body, /learn the tools and processes/);
    assert.doesNotMatch(
      body,
      /I am (?:an? )?(?:expert|senior)|I (?:have|use|know).*Django|years of Python/i,
    );
    assert.doesNotThrow(() => validateEvidence(c.profile, draft));
    const unverified = Profile.parse({
      ...c.profile,
      facts: c.profile.facts.map((f) => ({ ...f, verified: false })),
    });
    assert.throws(
      () => startingDraft(unverified, job, c.company, ['backend'], '2026-11-13'),
      /verified/,
    );
  } finally {
    await s.cleanup();
  }
});

test('explicitly missing Calibri configuration fails instead of silently promising fidelity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'applykit-font-test-')),
    previous = process.env.APPLYKIT_FONT_DIR;
  try {
    process.env.APPLYKIT_FONT_DIR = directory;
    await assert.rejects(loadFonts(), /four|regular, bold/);
  } finally {
    if (previous === undefined) delete process.env.APPLYKIT_FONT_DIR;
    else process.env.APPLYKIT_FONT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
