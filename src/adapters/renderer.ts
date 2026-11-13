import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ExternalHyperlink,
  AlignmentType,
  HeadingLevel,
} from 'docx';
import { PDFDocument } from 'pdf-lib';
import type { ArtifactRenderer } from '../application/ports.js';
import type { DocumentModel } from '../domain/models.js';
import { packageRoot } from './package.js';

const require = createRequire(import.meta.url);
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function markdown(model: DocumentModel, letter = false): string {
  const header = `# ${model.name}\n\n${model.headline}\n\n${model.contact.join(' | ')}\n\n${model.links.map((l) => `[${l.label}](${l.url})`).join(' | ')}\n\n`;
  return (
    header +
    (letter
      ? `${model.date}\n\n${model.company}\n\nDear Hiring Team,\n\n${model.coverLetter.join('\n\n')}\n\nYours sincerely,\n\n${model.name}\n`
      : `${model.summary ? model.summary + '\n\n' : ''}${model.sections.map((s) => `## ${s.title}\n\n${s.paragraphs.map((p) => `- ${p.replaceAll('\n', '\n  ')}`).join('\n')}\n`).join('\n')}`)
  );
}
function html(
  model: DocumentModel,
  css: string,
  font: string,
  bold: string,
  letter: boolean,
): string {
  const header = `<header><h1>${escape(model.name)}</h1><div class="headline">${escape(model.headline)}</div><p class="contact">${escape(model.contact.join(' | '))}</p><p class="contact">${model.links.map((l) => `<a href="${escape(l.url)}">${escape(l.label)}</a>`).join(' | ')}</p></header>`;
  const content = letter
    ? `<main class="letter"><p class="date">${escape(model.date)}</p><p>${escape(model.company)}</p><p>Dear Hiring Team,</p>${model.coverLetter.map((p) => `<p>${escape(p)}</p>`).join('')}<p>Yours sincerely,<br>${escape(model.name)}</p></main>`
    : `<main>${model.summary ? `<p>${escape(model.summary)}</p>` : ''}${model.sections.map((s) => `<section><h2>${escape(s.title)}</h2><ul>${s.paragraphs.map((p) => `<li>${escape(p)}</li>`).join('')}</ul></section>`).join('')}</main>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(model.name)} ${letter ? 'Cover Letter' : 'Resume'}</title><style>@font-face{font-family:Carlito;src:url(data:font/woff2;base64,${font});font-weight:400}@font-face{font-family:Carlito;src:url(data:font/woff2;base64,${bold});font-weight:700}${css}</style><body>${header}${content}</body></html>`;
}
async function word(model: DocumentModel, letter: boolean): Promise<Uint8Array> {
  const para = (value: string, options: object = {}) =>
    new Paragraph({
      children: value
        .split('\n')
        .map((line, index) => new TextRun({ text: line, ...(index ? { break: 1 } : {}) })),
      spacing: { after: 110 },
      ...options,
    });
  const children: Paragraph[] = [
    para(model.name, { heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: model.headline, bold: true, color: '2563EB', size: 24 })],
    }),
    para(model.contact.join(' | '), { alignment: AlignmentType.CENTER }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: model.links.flatMap((l, i) => [
        ...(i ? [new TextRun(' | ')] : []),
        new ExternalHyperlink({
          link: l.url,
          children: [
            new TextRun({ text: l.label, color: '2563EB', underline: { type: 'single' } }),
          ],
        }),
      ]),
    }),
  ];
  if (letter)
    children.push(
      para(model.date),
      para(model.company),
      para('Dear Hiring Team,'),
      ...model.coverLetter.map((p) => para(p, { spacing: { after: 220 } })),
      para('Yours sincerely,'),
      para(model.name),
    );
  else {
    if (model.summary) children.push(para(model.summary));
    for (const section of model.sections)
      children.push(
        para(section.title.toUpperCase(), { heading: HeadingLevel.HEADING_1 }),
        ...section.paragraphs.map((p) => para(p, { bullet: { level: 0 } })),
      );
  }
  const doc = new Document({
    creator: 'Job Application Kit',
    title: `${model.name} ${letter ? 'Cover Letter' : 'Resume'}`,
    styles: {
      default: {
        document: {
          run: { font: 'Carlito', size: 22, color: '111827' },
          paragraph: { spacing: { line: 270 } },
        },
        title: { run: { size: 50, bold: true, color: '1F2937' } },
        heading1: {
          run: { size: 23, bold: true, color: '1F2937' },
          paragraph: { spacing: { before: 220, after: 100 }, keepNext: true },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 850, bottom: 850, left: 1020, right: 1020 },
          },
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc);
}
export class Renderer implements ArtifactRenderer {
  async render(model: DocumentModel) {
    const [css, font, bold] = await Promise.all([
      readFile(new URL('templates/document.css', packageRoot), 'utf8'),
      readFile(
        require.resolve('@fontsource/carlito/files/carlito-latin-400-normal.woff2'),
        'base64',
      ),
      readFile(
        require.resolve('@fontsource/carlito/files/carlito-latin-700-normal.woff2'),
        'base64',
      ),
    ]);
    const browser = await chromium.launch({ headless: true });
    const files: Record<string, Uint8Array> = {};
    const pages = { resume: 0, coverLetter: 0 };
    try {
      const page = await browser.newPage();
      await page.route('**/*', (r) => r.abort());
      for (const letter of [false, true]) {
        const stem = letter ? 'cover-letter' : 'resume';
        await page.setContent(html(model, css, font, bold, letter), { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          tagged: true,
        });
        pages[letter ? 'coverLetter' : 'resume'] = (await PDFDocument.load(pdf)).getPageCount();
        files[`${stem}.pdf`] = pdf;
        files[`${stem}.docx`] = await word(model, letter);
        files[`${stem}.md`] = new TextEncoder().encode(markdown(model, letter));
      }
      files['email.md'] = new TextEncoder().encode(
        `Subject: ${model.email.subject}\n\nDear Hiring Team,\n\n${model.email.paragraphs.join('\n\n')}\n\nKind regards,\n${model.name}\n`,
      );
      return { files, pages };
    } finally {
      await browser.close();
    }
  }
}
