import type { DocumentModel, ResumeEntry } from '../../domain/documents.js';
import { theme, points } from './theme.js';
import { letterGreeting as greeting } from '../../domain/documents.js';
import type { FontSet } from './fonts.js';
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
function entryHtml(entry: ResumeEntry): string {
  switch (entry.type) {
    case 'paragraph':
      return `<p class="summary">${escape(entry.text)}</p>`;
    case 'bullet':
      return `<ul class="bullets"><li>${escape(entry.text)}</li></ul>`;
    case 'skill':
      return `<p class="skill-row">${entry.label ? `<strong>${escape(entry.label)}: </strong>` : ''}${escape(entry.text)}</p>`;
    case 'experience':
      return `<div class="job-header"><strong>${escape(entry.title)}</strong>${entry.dates ? `<span class="dates">${escape(entry.dates)}</span>` : ''}</div>${entry.context ? `<p class="job-context">${escape(entry.context)}</p>` : ''}${entry.bullets.length ? `<ul class="bullets">${entry.bullets.map((line) => `<li>${escape(line)}</li>`).join('')}</ul>` : ''}`;
    case 'project':
      return `<p class="project">${entry.url ? `<a href="${escape(entry.url)}">${escape(entry.name)}</a>` : `<strong>${escape(entry.name)}</strong>`}${entry.description ? `: ${escape(entry.description)}` : ''}${entry.technologies ? `<span class="technologies">&nbsp;&nbsp;(${escape(entry.technologies)})</span>` : ''}</p>`;
    case 'education':
      return `<p class="qualification">${escape(entry.qualification)}</p>${entry.details ? `<p class="education-details">${escape(entry.details)}</p>` : ''}${entry.description ? `<p class="summary">${escape(entry.description)}</p>` : ''}`;
  }
}
export function documentHtml(
  model: DocumentModel,
  css: string,
  fonts: FontSet,
  letter: boolean,
): string {
  const side = letter ? theme.page.letterSide : theme.page.resumeSide;
  const variables = [
    ...Object.entries(theme.colors).map(([key, value]) => `--color-${key}:#${value}`),
    ...Object.entries(theme.spacing).map(([key, value]) => `--${key}:${points(value)}pt`),
    ...Object.entries(theme.size).map(([key, value]) => `--${key}:${value / 2}pt`),
    `--name-size:${(letter ? theme.size.letterName : theme.size.resumeName) / 2}pt`,
    `--name-tracking:${points(theme.tracking.name)}pt`,
    `--heading-tracking:${points(theme.tracking.heading)}pt`,
    `--contact-after:${points(letter ? theme.spacing.letterContactAfter : theme.spacing.resumeContactAfter)}pt`,
    `--font-family:${fonts.family}`,
    `--rule-width:${theme.rule.size / 8}pt`,
    `--rule-space:${theme.rule.space}pt`,
    `--job-tab:${theme.jobTabInches}in`,
  ].join(';');
  const contact = [
    ...(model.contact.length ? [escape(model.contact.join('  |  '))] : []),
    ...model.links.map((link) => `<a href="${escape(link.url)}">${escape(link.label)}</a>`),
  ].join('  |  ');
  const header = `<header><h1>${escape(model.name.toUpperCase())}</h1><p class="headline">${escape(model.headline)}</p><p class="contact">${contact}</p>${!letter && model.availability ? `<p class="availability">${escape(model.availability)}</p>` : ''}</header>`;
  const address = model.recipient?.addressLines ?? [];
  const content = letter
    ? `<main><p class="tight">${escape(model.date)}</p><p>&nbsp;</p>${model.recipient?.hiringManager ? `<p class="tight">${escape(model.recipient.hiringManager)}</p>` : ''}<p${address.length ? ' class="tight"' : ''}>${escape(model.company)}</p>${address.map((line, index) => `<p${index < address.length - 1 ? ' class="tight"' : ''}>${escape(line)}</p>`).join('')}<p>${escape(greeting(model))}</p>${model.coverLetter.map((p) => `<p>${escape(p)}</p>`).join('')}<p>Yours sincerely,</p><p>${escape(model.name)}</p></main>`
    : `<main>${model.sections.map((section) => `<section><h2>${escape(section.title)}</h2>${section.entries.map(entryHtml).join('')}</section>`).join('')}</main>`;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(model.name)} ${letter ? 'Cover Letter' : 'Resume'}</title><style>${fonts.css}:root{${variables}}@page{size:${points(theme.page.width)}pt ${points(theme.page.height)}pt;margin:${points(theme.page.top)}pt ${points(side)}pt ${points(theme.page.bottom)}pt}${css}</style><body class="${letter ? 'letter' : 'resume'}">${header}${content}</body></html>`;
}
