import { Paragraph, BorderStyle, convertInchesToTwip } from 'docx';
import type { DocumentModel, ResumeEntry } from '../../domain/documents.js';
import { theme } from './theme.js';
import { document, header, runs, link } from './shared.js';

function sectionHeading(text: string): Paragraph {
  return new Paragraph({
    keepNext: true,
    spacing: { before: theme.spacing.headingBefore, after: theme.spacing.headingAfter },
    border: {
      bottom: {
        color: theme.colors.navy,
        space: theme.rule.space,
        style: BorderStyle.SINGLE,
        size: theme.rule.size,
      },
    },
    children: runs(text.toUpperCase(), {
      bold: true,
      size: theme.size.heading,
      color: theme.colors.navy,
      characterSpacing: theme.tracking.heading,
    }),
  });
}
const bullet = (text: string) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: theme.spacing.bulletAfter },
    children: runs(text),
  });
const summaryPara = (text: string) =>
  new Paragraph({ spacing: { after: theme.spacing.summaryAfter }, children: runs(text) });
function entryParagraphs(entry: ResumeEntry): Paragraph[] {
  switch (entry.type) {
    case 'paragraph':
      return [summaryPara(entry.text)];
    case 'bullet':
      return [bullet(entry.text)];
    case 'skill':
      return [
        new Paragraph({
          spacing: { after: theme.spacing.skillAfter },
          children: [
            ...(entry.label
              ? runs(`${entry.label}: `, { bold: true, color: theme.colors.navy })
              : []),
            ...runs(entry.text),
          ],
        }),
      ];
    case 'experience':
      return [
        new Paragraph({
          keepNext: true,
          spacing: { before: theme.spacing.jobBefore, after: theme.spacing.jobAfter },
          tabStops: [{ type: 'right', position: convertInchesToTwip(theme.jobTabInches) }],
          children: [
            ...runs(entry.title, {
              bold: true,
              size: theme.size.heading,
              color: theme.colors.navy,
            }),
            ...(entry.dates
              ? runs(`\t${entry.dates}`, {
                  size: theme.size.contact,
                  color: theme.colors.gray,
                  italics: true,
                })
              : []),
          ],
        }),
        ...(entry.context
          ? [
              new Paragraph({
                keepNext: true,
                spacing: { after: theme.spacing.contextAfter },
                children: runs(entry.context, {
                  size: theme.size.contact,
                  color: theme.colors.gray,
                  italics: true,
                }),
              }),
            ]
          : []),
        ...entry.bullets.map(bullet),
      ];
    case 'project':
      return [
        new Paragraph({
          spacing: { after: theme.spacing.projectAfter },
          children: [
            ...(entry.url
              ? [link(entry.name, entry.url)]
              : runs(entry.name, { bold: true, color: theme.colors.navy })),
            ...(entry.description
              ? [...runs(' — ', { color: theme.colors.navy }), ...runs(entry.description)]
              : []),
            ...(entry.technologies
              ? runs(`  (${entry.technologies})`, {
                  size: theme.size.small,
                  color: theme.colors.gray,
                  italics: true,
                })
              : []),
          ],
        }),
      ];
    case 'education':
      return [
        new Paragraph({
          keepNext: Boolean(entry.details || entry.description),
          spacing: { after: theme.spacing.qualificationAfter },
          children: runs(entry.qualification, { bold: true, color: theme.colors.navy }),
        }),
        ...(entry.details
          ? [
              new Paragraph({
                spacing: { after: theme.spacing.educationAfter },
                children: runs(entry.details, {
                  size: theme.size.contact,
                  color: theme.colors.gray,
                  italics: true,
                }),
              }),
            ]
          : []),
        ...(entry.description ? [summaryPara(entry.description)] : []),
      ];
  }
}
export function buildResume(model: DocumentModel) {
  return document(model, false, [
    ...header(model, false),
    ...model.sections.flatMap((section) => [
      sectionHeading(section.title),
      ...section.entries.flatMap(entryParagraphs),
    ]),
  ]);
}
