import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function readCompanies(file: string): Promise<unknown[]> {
  if (file.toLowerCase().endsWith('.csv')) {
    const rows = parse(await readFile(file, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      trim: true,
    }) as Record<string, string>[];
    return rows.map((row) =>
      Object.fromEntries([['version', 1], ...Object.entries(row).filter(([, v]) => v !== '')]),
    );
  }
  const value = await readJson(file);
  if (!Array.isArray(value))
    throw new Error('Company import must be a JSON array or CSV with headers');
  return value;
}
