import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { Packer } from 'docx';
import { PDFDocument } from 'pdf-lib';
import type { ArtifactRenderer } from '../application/ports.js';
import type { DocumentModel } from '../domain/documents.js';
import { packageRoot } from './package.js';
import { buildResume } from './documents/resume_build.js';
import { buildCoverLetter } from './documents/cover_letter.js';
import { documentHtml } from './documents/html.js';
import { markdown } from './documents/markdown.js';
import { inspectWord } from './word-layout.js';
import { loadFonts } from './documents/fonts.js';
export { markdown } from './documents/markdown.js';

/** I/O orchestration only; each original document has its own template module. */
export class Renderer implements ArtifactRenderer {
  async render(model: DocumentModel, options: { checkWord?: boolean } = {}) {
    const [css, fonts] = await Promise.all([
      readFile(new URL('templates/document.css', packageRoot), 'utf8'),
      loadFonts(),
    ]);
    const browser = await chromium.launch({ headless: true });
    const files: Record<string, Uint8Array> = {},
      pages = { resume: 0, coverLetter: 0 };
    try {
      const page = await browser.newPage();
      await page.route('**/*', (route) => route.abort());
      for (const letter of [false, true]) {
        const stem = letter ? 'cover-letter' : 'resume';
        const html = documentHtml(model, css, fonts, letter);
        const preview = html
          .replace(
            '<meta charset="utf-8">',
            "<meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'\">",
          )
          .replace(
            '</style>',
            `body{max-width:612pt;min-height:792pt;margin:0 auto;padding:36pt ${letter ? 54 : 45}pt;background:#fff}</style>`,
          );
        files[`${stem}.preview.html`] = new TextEncoder().encode(preview);
        await page.setContent(html, { waitUntil: 'load' });
        try {
          const loaded = await page.evaluate(async (family) => {
            for (const style of ['normal 400', 'normal 700', 'italic 400', 'italic 700']) {
              const faces = await document.fonts.load(`${style} 11pt "${family}"`);
              if (!faces.length || faces.some((face) => face.status !== 'loaded')) return false;
            }
            return true;
          }, fonts.family);
          if (!loaded) throw new Error('Font family could not be loaded');
        } catch {
          throw new Error(
            'Document fonts could not be loaded. Check APPLYKIT_FONT_DIR or reinstall the bundled font dependency.',
          );
        }
        const pdf = await page.pdf({
          format: 'Letter',
          printBackground: true,
          preferCSSPageSize: true,
          tagged: true,
        });
        pages[letter ? 'coverLetter' : 'resume'] = (await PDFDocument.load(pdf)).getPageCount();
        files[`${stem}.pdf`] = pdf;
        files[`${stem}.docx`] = await Packer.toBuffer(
          letter ? buildCoverLetter(model) : buildResume(model),
        );
        files[`${stem}.md`] = new TextEncoder().encode(markdown(model, letter));
      }
      files['email.md'] = new TextEncoder().encode(
        `Subject: ${model.email.subject}\n\nDear Hiring Team,\n\n${model.email.paragraphs.join('\n\n')}\n\nKind regards,\n${model.name}\n`,
      );
      const wordPages = options.checkWord ? await inspectWord(files) : undefined;
      return {
        files,
        pages,
        ...(wordPages ? { wordPages } : {}),
        warnings: [
          ...fonts.warnings,
          ...(wordPages
            ? [
                'Word pagination was measured with LibreOffice. Review the preview and the DOCX in your target Word application.',
              ]
            : [
                'Word pagination has not been checked. Use application build --check-word with LibreOffice installed.',
              ]),
        ],
      };
    } finally {
      await browser.close();
    }
  }
}
