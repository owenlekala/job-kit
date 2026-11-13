import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

/** Optional LibreOffice conversion measures Word pagination independently from Chromium. */
export async function inspectWord(files: Record<string, Uint8Array>) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'applykit-word-'));
  try {
    const output = path.join(temporary, 'converted');
    await fs.mkdir(output);
    const input = ['resume', 'cover-letter'].map((name) => path.join(temporary, `${name}.docx`));
    for (const [index, filename] of input.entries())
      await fs.writeFile(filename, files[index === 0 ? 'resume.docx' : 'cover-letter.docx']!, {
        mode: 0o600,
      });
    try {
      await promisify(execFile)(
        process.env.APPLYKIT_SOFFICE ?? 'soffice',
        [
          `-env:UserInstallation=${pathToFileURL(path.join(temporary, 'office-profile')).href}`,
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          output,
          ...input,
        ],
        { timeout: 60000, maxBuffer: 1024 * 1024, windowsHide: true },
      );
    } catch {
      throw new Error(
        'Word layout verification requires LibreOffice. Install it or set APPLYKIT_SOFFICE to its executable path. Conversion must complete within 60 seconds.',
      );
    }
    const wordPages = { resume: 0, coverLetter: 0 };
    for (const stem of ['resume', 'cover-letter']) {
      const bytes = await fs.readFile(path.join(output, `${stem}.pdf`));
      wordPages[stem === 'resume' ? 'resume' : 'coverLetter'] = (
        await PDFDocument.load(bytes)
      ).getPageCount();
      files[`${stem}.word-preview.pdf`] = bytes;
    }
    return wordPages;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
