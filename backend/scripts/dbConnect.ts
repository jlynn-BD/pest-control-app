import readline from "node:readline";
import { PrismaClient } from "@prisma/client";

// The production connection string is a password, so it is never read from
// .env (which would point at a local database anyway) and is not expected on
// the command line (shell history). Either set it in the environment for one
// run, or type/paste it when asked - the input is hidden.
export async function connectionString(envName: string, label: string): Promise<string> {
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv;
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
  process.stdout.write("\n");
  if (!/^postgres(ql)?:\/\//.test(answer)) throw new Error("That does not look like a postgres:// connection string.");
  return answer;
}

export function client(url: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: url, log: [] });
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

export function ident(name: string): string {
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`Unexpected table or column name: ${name}`);
  return `"${name}"`;
}
