import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import WebSocket from 'ws';
import { AUTH_HEADER, lockDir, type AgentMethod, type AgentMethods, type AgentResponse, type Lockfile } from '@hai-browser/protocol';

export function readLockfiles(dir = lockDir()): Lockfile[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json'));
  } catch {
    return [];
  }
  const locks: Lockfile[] = [];
  for (const name of names) {
    try {
      locks.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    } catch {
      // Ignore partially written or corrupt lockfiles.
    }
  }
  return locks;
}

const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
};

/** Prefer the VS Code window whose workspace contains `cwd`; otherwise the newest live window. */
export function pickLockfile(locks: Lockfile[], cwd: string, isAlive: (pid: number) => boolean = pidAlive): Lockfile | undefined {
  const live = locks.filter(l => isAlive(l.pid));
  let best: { lock: Lockfile; depth: number } | undefined;
  for (const lock of live) {
    for (const folder of lock.workspaceFolders) {
      if (isInside(cwd, folder) && (!best || folder.length > best.depth)) best = { lock, depth: folder.length };
    }
  }
  return best?.lock ?? [...live].sort((a, b) => b.startedAt - a.startedAt)[0];
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

const NOT_RUNNING =
  'The H/Ai VS Code extension is not running. Open VS Code (1.119+) with the "H/Ai Browser" extension installed, then retry.';

/** Lazily (re)connects to the extension's agent API. */
export class ExtensionConnection {
  private ws?: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, (res: AgentResponse) => void>();

  constructor(private readonly cwd: string = process.cwd()) {}

  async call<M extends AgentMethod>(method: M, params: AgentMethods[M]['params']): Promise<AgentMethods[M]['result']> {
    const ws = await this.connect();
    const id = this.nextId++;
    const res = await new Promise<AgentResponse>((resolve, reject) => {
      this.pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }), err => err && reject(err));
    });
    if ('error' in res) throw new Error(res.error.message);
    return res.result as AgentMethods[M]['result'];
  }

  close() {
    this.ws?.close();
  }

  private async connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return this.ws;
    const lock = pickLockfile(readLockfiles(), this.cwd);
    if (!lock) throw new Error(NOT_RUNNING);
    const ws = new WebSocket(`ws://127.0.0.1:${lock.port}`, { headers: { [AUTH_HEADER]: lock.token } });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', () => reject(new Error(NOT_RUNNING)));
    });
    ws.on('message', raw => {
      const res = JSON.parse(raw.toString()) as AgentResponse;
      this.pending.get(res.id)?.(res);
      this.pending.delete(res.id);
    });
    ws.on('close', () => {
      for (const [id, resolve] of this.pending) resolve({ id, error: { message: 'Connection to VS Code closed.' } });
      this.pending.clear();
      if (this.ws === ws) this.ws = undefined;
    });
    this.ws = ws;
    return ws;
  }
}
