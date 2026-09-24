import type { LocalDb } from "./database";

// Phones (iOS/Android) use expo-sqlite directly - see database.ts - so the
// web-only sql.js backend must not be bundled into them at all (it pulls in
// Node's `fs`, which doesn't exist there and stops the native build).
// Metro picks webSqlDatabase.web.ts on web and this stub everywhere else;
// the exports match so the shared code stays platform-agnostic.
export function initWebSqlDatabase(): Promise<void> {
  return Promise.resolve();
}

export function isWebSqlReady(): boolean {
  return false;
}

export const webSqlAdapter: LocalDb = {
  execSync: () => {
    throw new Error("The web SQL database is only available on web");
  },
  runSync: () => {
    throw new Error("The web SQL database is only available on web");
  },
  getFirstSync: () => {
    throw new Error("The web SQL database is only available on web");
  },
  getAllSync: () => {
    throw new Error("The web SQL database is only available on web");
  },
  withTransactionSync: () => {
    throw new Error("The web SQL database is only available on web");
  },
};
