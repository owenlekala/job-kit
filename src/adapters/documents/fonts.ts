import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
export interface FontSet {
  family: 'Calibri' | 'Carlito';
  css: string;
  warnings: string[];
}
const faces = [
  { weight: 400, style: 'normal', names: ['calibri', 'calibriregular'] },
  { weight: 700, style: 'normal', names: ['calibrib', 'calibribold'] },
  { weight: 400, style: 'italic', names: ['calibrii', 'calibriitalic'] },
  { weight: 700, style: 'italic', names: ['calibriz', 'calibribolditalic'] },
];
export async function loadFonts(): Promise<FontSet> {
  const directories = process.env.APPLYKIT_FONT_DIR
    ? [process.env.APPLYKIT_FONT_DIR]
    : [
        path.join(process.env.WINDIR ?? 'C:/Windows', 'Fonts'),
        '/Library/Fonts',
        path.join(os.homedir(), 'Library', 'Fonts'),
        '/Applications/Microsoft Word.app/Contents/Resources/DFonts',
        '/usr/share/fonts/truetype/microsoft',
        path.join(os.homedir(), '.local', 'share', 'fonts'),
      ];
  for (const directory of directories) {
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (e) {
      if (process.env.APPLYKIT_FONT_DIR)
        throw new Error(
          'APPLYKIT_FONT_DIR cannot be read; point it at a directory containing the four Calibri font faces',
        );
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    const selected = faces.map((face) =>
      files.find(
        (file) =>
          /\.(ttf|otf|woff2?)$/i.test(file) &&
          face.names.includes(
            path
              .parse(file)
              .name.toLowerCase()
              .replace(/[\s_-]/g, ''),
          ),
      ),
    );
    if (selected.every(Boolean)) {
      const css = (
        await Promise.all(
          selected.map(async (file, index) => {
            const bytes = await readFile(path.join(directory, file!), 'base64'),
              ext = path.extname(file!).slice(1).toLowerCase();
            return `@font-face{font-family:Calibri;src:url(data:font/${ext};base64,${bytes});font-weight:${faces[index]!.weight};font-style:${faces[index]!.style}}`;
          }),
        )
      ).join('');
      return { family: 'Calibri', css, warnings: [] };
    }
  }
  if (process.env.APPLYKIT_FONT_DIR)
    throw new Error(
      'APPLYKIT_FONT_DIR must contain Calibri regular, bold, italic, and bold italic font files',
    );
  const css = (
    await Promise.all(
      faces.map(
        async (face) =>
          `@font-face{font-family:Carlito;src:url(data:font/woff2;base64,${await readFile(require.resolve(`@fontsource/carlito/files/carlito-latin-${face.weight}-${face.style}.woff2`), 'base64')});font-weight:${face.weight};font-style:${face.style}}`,
      ),
    )
  ).join('');
  return {
    family: 'Carlito',
    css,
    warnings: [
      'Calibri font files were not found. DOCX requests Calibri; PDF uses metric-compatible Carlito. Set APPLYKIT_FONT_DIR to your licensed Calibri fonts for matching font rendering.',
    ],
  };
}
