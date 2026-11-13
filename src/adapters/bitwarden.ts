import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { CredentialVault } from '../application/ports.js';

export class Bitwarden implements CredentialVault {
  constructor(private readonly command: { file: string; prefix?: string[] } = { file: 'bw' }) {}
  private run(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // cmd is needed for npm-installed bw.cmd on Windows. All arguments here
      // are fixed commands or validated UUIDs; secret payloads use stdin only.
      const windowsShim = process.platform === 'win32' && this.command.file === 'bw';
      const file = windowsShim ? 'cmd.exe' : this.command.file;
      const parameters = [
        ...(windowsShim ? ['/d', '/s', '/c', 'bw'] : []),
        ...(this.command.prefix ?? []),
        ...args,
        '--nointeraction',
      ];
      const child = execFile(
        file,
        parameters,
        { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          // Never propagate execFile errors: they may include secret output.
          if (error)
            reject(
              new Error(
                'Bitwarden command failed. Install bw, log in, and unlock the vault in this terminal (BW_SESSION). No credentials were logged.',
              ),
            );
          else resolve(stdout.trim());
        },
      );
      child.stdin?.on('error', () => {});
      if (input !== undefined) child.stdin?.end(input);
      else child.stdin?.end();
    });
  }
  private async json<T>(args: string[], schema: z.ZodType<T>, input?: string): Promise<T> {
    const result = await this.run(args, input);
    try {
      return schema.parse(JSON.parse(result));
    } catch {
      throw new Error(
        'Bitwarden returned an invalid response; inspect vault status locally. No vault output was logged.',
      );
    }
  }
  async status(): Promise<string> {
    return (
      await this.json(
        ['status'],
        z.object({ status: z.enum(['unlocked', 'locked', 'unauthenticated']) }),
      )
    ).status;
  }
  async lookup(itemId: string) {
    if (!z.uuid().safeParse(itemId).success) throw new Error('Use the exact Bitwarden item UUID');
    const item = await this.json(
      ['get', 'item', itemId],
      z.object({
        type: z.literal(1),
        login: z.object({
          username: z.email(),
          password: z.string().min(1),
          uris: z.array(z.object({ uri: z.string().url() })),
        }),
      }),
    );
    return {
      email: String(item.login.username),
      password: String(item.login.password),
      uris: item.login.uris.map((u) => u.uri),
    };
  }
  async create(email: string, origin: string, tenant: string) {
    const template = await this.json(
      ['get', 'template', 'item'],
      z.record(z.string(), z.unknown()),
    );
    const password = randomBytes(24).toString('base64url') + 'aA1!';
    const payload = {
      ...template,
      type: 1,
      name: `ApplyKit — ${tenant} — ${origin}`,
      login: { username: email, password, totp: null, uris: [{ match: 1, uri: origin }] },
    };
    // Base64 is transport encoding, not encryption. Pass it over stdin, never argv.
    const created = await this.json(
      ['create', 'item'],
      z.object({ id: z.uuid() }),
      Buffer.from(JSON.stringify(payload)).toString('base64'),
    );
    return String(created.id);
  }
}
