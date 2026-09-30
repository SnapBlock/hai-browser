import WebSocket from 'ws';

type Listener = (params: any) => void;

/** Minimal CDP client for js-debug's CDP proxy (a page-target session). */
export class CdpClient {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve(v: any): void; reject(e: Error): void }>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private closed = false;

  private constructor(private readonly ws: WebSocket) {
    ws.on('message', raw => this.onMessage(raw.toString()));
    ws.on('close', () => {
      this.closed = true;
      for (const p of this.pending.values()) p.reject(new Error('CDP connection closed'));
      this.pending.clear();
      this.emit('close', undefined);
    });
  }

  static connect(url: string): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { perMessageDeflate: true });
      ws.once('open', () => resolve(new CdpClient(ws)));
      ws.once('error', reject);
    });
  }

  get isClosed() {
    return this.closed;
  }

  send<T = any>(method: string, params: object = {}): Promise<T> {
    if (this.closed) return Promise.reject(new Error('CDP connection closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, fn: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  close() {
    this.ws.close();
  }

  private emit(event: string, params: unknown) {
    for (const fn of this.listeners.get(event) ?? []) fn(params);
  }

  private onMessage(raw: string) {
    const msg = JSON.parse(raw);
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else if (msg.method) {
      this.emit(msg.method, msg.params);
    }
  }
}
