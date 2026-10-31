import { readClientApiKey } from "../daemon/auth";

// what a cli command prints when the daemon answers 401 to this machine's key
export const KEY_REJECTED_HINT = "set BANSOS_API_KEY or run: bansos key";

// a bad BANSOS_API_KEY or key file; callers print the message as one line and exit 1 instead of "not reachable"
export class ClientKeyError extends Error {}

export interface DaemonFetchOptions {
  env?: NodeJS.ProcessEnv;
  file?: string;
}

// fetch against the local daemon with this machine's key (env > key file); no key means no header
export async function daemonFetch(
  url: string | URL,
  init: RequestInit = {},
  opts: DaemonFetchOptions = {},
): Promise<Response> {
  let key: string | null;
  try {
    key = readClientApiKey(opts.env ?? process.env, opts.file);
  } catch (err) {
    throw new ClientKeyError((err as Error).message);
  }
  const headers = new Headers(init.headers);
  if (key) headers.set("authorization", `Bearer ${key}`);
  return fetch(url, { ...init, headers });
}
