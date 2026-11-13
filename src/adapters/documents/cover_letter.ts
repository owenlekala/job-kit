import { Paragraph } from 'docx';
import type { DocumentModel } from '../../domain/documents.js';
import { letterGreeting } from '../../domain/documents.js';
import { theme } from './theme.js';
import { document, header, runs } from './shared.js';

const para = (text: string) =>
  new Paragraph({
    spacing: { after: theme.spacing.letterParagraphAfter },
    children: runs(text, { size: theme.size.letterBody }),
  });
const tightLine = (text: string) =>
  new Paragraph({
    spacing: { after: theme.spacing.tightAfter },
    children: runs(text, { size: theme.size.letterBody }),
  });
export function buildCoverLetter(model: DocumentModel) {
  const address = model.recipient?.addressLines ?? [];
  return document(model, true, [
    ...header(model, true),
    tightLine(model.date),
    para(' '),
    ...(model.recipient?.hiringManager ? [tightLine(model.recipient.hiringManager)] : []),
    address.length ? tightLine(model.company) : para(model.company),
    ...address.map((line, index) => (index === address.length - 1 ? para(line) : tightLine(line))),
    para(letterGreeting(model)),
    ...model.coverLetter.map(para),
    para('Yours sincerely,'),
    para(model.name),
  ]);
}
