import { stdin, stdout } from 'node:process';

/** Read a local passphrase without echoing it or accepting it in process arguments. */
export async function readSecret(label: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY)
    throw new Error('Backup passphrases require an interactive terminal');
  stdout.write(label);
  const previous = stdin.isRaw;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = '';
      const finish = (error?: Error) => {
        stdin.off('data', onData);
        if (error) reject(error);
        else resolve(value);
      };
      const onData = (chunk: string) => {
        for (const character of chunk) {
          if (character === '\u0003' || character === '\u0004')
            return finish(new Error('Passphrase entry cancelled'));
          if (character === '\r' || character === '\n') return finish();
          if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
          else if (character >= ' ') value += character;
        }
      };
      stdin.on('data', onData);
    });
  } finally {
    stdin.setRawMode(previous);
    stdin.pause();
    stdout.write('\n');
  }
}
