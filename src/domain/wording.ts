/** Mechanical house-style checks complement, rather than replace, editorial review. */
export function validateDocumentWording(value: unknown, location = 'document'): void {
  if (typeof value === 'string' && value.includes('\u2014'))
    throw new Error(`${location} contains an em dash. Use a comma, colon, or separate sentence.`);
  if (Array.isArray(value))
    value.forEach((item, index) => validateDocumentWording(item, `${location}.${index + 1}`));
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value))
      validateDocumentWording(item, `${location}.${key}`);
}
