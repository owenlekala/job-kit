import type { DocumentModel, ResumeEntry } from '../../domain/documents.js';
import { letterGreeting as greeting } from '../../domain/documents.js';
function entryMarkdown(entry: ResumeEntry): string {
  switch (entry.type) {
    case 'paragraph':
      return entry.text;
    case 'bullet':
      return `- ${entry.text}`;
    case 'skill':
      return `${entry.label ? `**${entry.label}:** ` : ''}${entry.text}`;
    case 'experience':
      return `**${entry.title}**${entry.dates ? ` — *${entry.dates}*` : ''}${entry.context ? `\n\n*${entry.context}*` : ''}${entry.bullets.length ? '\n\n' + entry.bullets.map((p) => `- ${p.replaceAll('\n', '\n  ')}`).join('\n') : ''}`;
    case 'project':
      return `${entry.url ? `[${entry.name}](${entry.url})` : `**${entry.name}**`}${entry.description ? ` — ${entry.description}` : ''}${entry.technologies ? `  *(${entry.technologies})*` : ''}`;
    case 'education':
      return `**${entry.qualification}**${entry.details ? `\n\n*${entry.details}*` : ''}${entry.description ? `\n\n${entry.description}` : ''}`;
  }
}
export function markdown(model: DocumentModel, letter = false): string {
  const contact = [...model.contact, ...model.links.map((l) => `[${l.label}](${l.url})`)].join(
    ' | ',
  );
  const header = `# ${model.name.toUpperCase()}\n\n${model.headline}\n\n${contact}\n\n`;
  if (letter)
    return (
      header +
      `${model.date}\n\n${[model.recipient?.hiringManager, model.company, ...(model.recipient?.addressLines ?? [])].filter(Boolean).join('\n')}\n\n${greeting(model)}\n\n${model.coverLetter.join('\n\n')}\n\nYours sincerely,\n\n${model.name}\n`
    );
  return (
    header +
    (model.availability ? model.availability + '\n\n' : '') +
    model.sections
      .map(
        (section) => `## ${section.title}\n\n${section.entries.map(entryMarkdown).join('\n\n')}\n`,
      )
      .join('\n')
  );
}
