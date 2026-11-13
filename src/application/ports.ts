import type { z } from 'zod';
import type { DocumentModel } from '../domain/documents.js';

export interface Workspace {
  readonly root: string;
  file(...parts: string[]): string;
  initialize(allowLocalhost?: boolean): Promise<void>;
  read<T>(relative: string, schema: z.ZodType<T>): Promise<T>;
  get<T>(collection: string, key: string, schema: z.ZodType<T>): Promise<T>;
  write(relative: string, value: unknown): Promise<void>;
  put(collection: string, key: string, value: unknown): Promise<void>;
  writeBytes(relative: string, data: string | Uint8Array): Promise<void>;
  readBytes(relative: string): Promise<Uint8Array>;
  list<T>(collection: string, schema: z.ZodType<T>): Promise<T[]>;
  lock<T>(fn: () => Promise<T>): Promise<T>;
}
export interface CredentialVault {
  lookup(itemId: string): Promise<{ email: string; password: string; uris: string[] }>;
  create(email: string, origin: string, tenant: string): Promise<string>;
}
export interface ArtifactRenderer {
  render(model: DocumentModel): Promise<{
    files: Record<string, Uint8Array>;
    pages: { resume: number; coverLetter: number };
    warnings?: string[];
  }>;
}
export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  fields: { selector: string; type: string; label: string; value?: string }[];
  buttons: { selector: string; text: string }[];
}
export interface BrowserDriver {
  readonly allowedOrigins: Set<string>;
  navigate(url: string): Promise<void>;
  snapshot(): Promise<PageSnapshot>;
  fill(selector: string, value: string, sensitive?: boolean): Promise<void>;
  check(selector: string, value: boolean): Promise<void>;
  select(selector: string, value: string): Promise<void>;
  upload(selector: string, bytes: Uint8Array, name: string): Promise<void>;
  click(selector: string, intent?: 'click' | 'login' | 'register' | 'submit'): Promise<void>;
  wait(selector: string, expectedText?: string): Promise<void>;
  read(selector: string): Promise<string | boolean>;
  fileNames(selector: string): Promise<string[]>;
  fileHashes(selector: string): Promise<Record<string, string>>;
  verifyForm(
    submitSelector: string,
    checked: string[],
    credentialSelectors: string[],
  ): Promise<void>;
  close(): Promise<void>;
}
