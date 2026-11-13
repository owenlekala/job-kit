import {
  Document,
  Paragraph,
  TextRun,
  Tab,
  ExternalHyperlink,
  AlignmentType,
  type IRunOptions,
} from 'docx';
import type { DocumentModel } from '../../domain/documents.js';
import { theme } from './theme.js';

export function runs(text: string, options: IRunOptions = {}): TextRun[] {
  return text.split('\n').map(
    (line, index) =>
      new TextRun({
        font: theme.font,
        size: theme.size.body,
        color: theme.colors.body,
        ...options,
        ...(line.includes('\t')
          ? { children: line.split('\t').flatMap((part, i) => [...(i ? [new Tab()] : []), part]) }
          : { text: line }),
        ...(index ? { break: 1 } : {}),
      }),
  );
}
export function link(text: string, url: string): ExternalHyperlink {
  return new ExternalHyperlink({
    link: url,
    children: runs(text, {
      font: theme.font,
      size: theme.size.contact,
      color: theme.colors.accent,
      underline: { type: 'single' },
    }),
  });
}
export function contact(model: DocumentModel): (TextRun | ExternalHyperlink)[] {
  const children: (TextRun | ExternalHyperlink)[] = runs(model.contact.join('  |  '), {
    size: theme.size.contact,
    color: theme.colors.gray,
  });
  model.links.forEach((l, index) => {
    if (model.contact.length || index)
      children.push(...runs('  |  ', { size: theme.size.contact, color: theme.colors.gray }));
    children.push(link(l.label, l.url));
  });
  return children;
}
export function header(model: DocumentModel, letter: boolean): Paragraph[] {
  const paragraphs = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: theme.spacing.nameAfter },
      children: runs(model.name.toUpperCase(), {
        bold: true,
        size: letter ? theme.size.letterName : theme.size.resumeName,
        color: theme.colors.navy,
        characterSpacing: theme.tracking.name,
      }),
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: theme.spacing.headlineAfter },
      children: runs(model.headline, {
        bold: true,
        size: theme.size.headline,
        color: theme.colors.accent,
      }),
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: {
        after: letter ? theme.spacing.letterContactAfter : theme.spacing.resumeContactAfter,
      },
      children: contact(model),
    }),
  ];
  if (!letter && model.availability)
    paragraphs.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: theme.spacing.resumeContactAfter },
        children: runs(model.availability, { size: theme.size.contact, color: theme.colors.gray }),
      }),
    );
  return paragraphs;
}
export function document(model: DocumentModel, letter: boolean, children: Paragraph[]): Document {
  const side = letter ? theme.page.letterSide : theme.page.resumeSide;
  return new Document({
    creator: 'Job Application Kit',
    title: `${model.name} ${letter ? 'Cover Letter' : 'Resume'}`,
    sections: [
      {
        properties: {
          page: {
            size: { width: theme.page.width, height: theme.page.height },
            margin: { top: theme.page.top, bottom: theme.page.bottom, left: side, right: side },
          },
        },
        children,
      },
    ],
  });
}
