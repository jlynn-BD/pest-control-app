import readline from "node:readline";
import { PrismaClient } from "@prisma/client";

// The production connection string is a password, so it is never read from
// .env (which would point at a local database anyway) and is not expected on
// the command line (shell history). Either set it in the environment for one
// run, or type/paste it when asked - the input is hidden.
export async function connectionString(envName: string, label: string): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv) return checked(fromEnv);
  if (!process.stdin.isTTY) throw new Error(`Set ${envName} (no terminal to ask in).`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
  let hidden = false;
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    if (!hidden) write.call(rl, s);
  };
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${label}: `, (a) => resolve(a.trim()));
    hidden = true;
  });
  rl.close();
  process.stdout.write(`\n(received ${answer.length} characters)\n`);
  return checked(answer);
}

// Nothing is echoed while pasting, so a double paste is easy to do by accident:
// catch it here, with a message that never repeats the password.
function checked(raw: string): string {
  const answer = raw.trim();
  if ((answer.match(/postgres(ql)?:\/\//g) ?? []).length > 1) {
    throw new Error("The connection string was pasted twice. Run the command again and paste it once, then press Enter.");
  }
  let u: URL;
  try {
    u = new URL(answer);
  } catch {
    throw new Error("That is not a valid connection string. It should look like postgresql://user:password@host/database");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol) || !u.hostname || !/^\/[A-Za-z0-9_-]+$/.test(u.pathname)) {
    throw new Error("That is not a valid connection string. It should look like postgresql://user:password@host/database");
  }
  return answer;
}

export function client(url: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, log: [] });
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.slice(0, 80);
  } catch {
    return "(unparseable)";
  }
}

export function ident(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unexpected table or column name: ${name}`);
  return `"${name}"`;
}
