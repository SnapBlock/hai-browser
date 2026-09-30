import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { AUTH_HEADER, lockDir, type AgentRequest, type AgentResponse, type Lockfile } from '@hai-browser/protocol';

export type Handler = (req: AgentRequest) => Promise<unknown>;

/**
 * Localhost WebSocket endpoint that `hai-browser-mcp` connects to. Discovery is a
 * per-window lockfile containing the port and a random token.
 */
export class AgentServer {
  private readonly token = randomBytes(24).toString('hex');
  private readonly lockPath = join(lockDir(), `${process.pid}.json`);
  private wss?: WebSocketServer;

  constructor(private readonly handle: Handler) {}

  async start(workspaceFolders: string[]): Promise<number> {
    const wss = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      verifyClient: (info: { req: IncomingMessage }) => info.req.headers[AUTH_HEADER] === this.token,
    });
    await new Promise<void>((resolve, reject) => {
      wss.once('listening', resolve);
      wss.once('error', reject);
    });
    wss.on('connection', ws => this.onConnection(ws));
    this.wss = wss;
    const port = (wss.address() as AddressInfo).port;
    this.writeLockfile(port, workspaceFolders);
    return port;
  }

  updateWorkspaceFolders(workspaceFolders: string[]) {
    if (this.wss) this.writeLockfile((this.wss.address() as AddressInfo).port, workspaceFolders);
  }

  get lockfilePath() {
    return this.lockPath;
  }

  dispose() {
    rmSync(this.lockPath, { force: true });
    this.wss?.close();
  }

  private writeLockfile(port: number, workspaceFolders: string[]) {
    mkdirSync(lockDir(), { recursive: true, mode: 0o700 });
    const lock: Lockfile = { pid: process.pid, port, token: this.token, workspaceFolders, startedAt: Date.now() };
    writeFileSync(this.lockPath, JSON.stringify(lock, null, 2), { mode: 0o600 });
  }

  private onConnection(ws: WebSocket) {
    ws.on('message', async raw => {
      let req: AgentRequest;
      try {
        req = JSON.parse(raw.toString());
      } catch {
        return;
      }
      let res: AgentResponse;
      try {
        res = { id: req.id, result: await this.handle(req) };
      } catch (e) {
        res = { id: req.id, error: { message: e instanceof Error ? e.message : String(e) } };
      }
      ws.send(JSON.stringify(res));
    });
  }
}
