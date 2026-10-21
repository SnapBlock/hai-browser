import type { RefInfo } from './pageScripts';

/** An action that needs the user's OK first: what the agent wants to do, and why it is risky. */
export interface Risk {
  site: string;
  action: string;
  why: string;
}

export interface GuardRequest {
  method: string;
  params: Record<string, any>;
  /** The page the action runs on. */
  url?: string;
  /** The element behind `params.ref`, when there is one. */
  target?: RefInfo;
}

const SECRET_FIELD = /pass(word|code|phrase)?\b|api[\s_-]?key|secret|token|\botp\b|one[\s-]time|verification code|security code|auth(entication)? code|\b2fa\b|card|cvv|cvc|\biban\b|ssn|social security/i;
const SUBMIT_BUTTON =
  /^(submit|send|sign\s?up|register|create (an )?account|pay|buy|purchase|place (the )?order|check\s?out|confirm|delete|remove|publish|post|transfer|subscribe|apply|book|donate)\b/i;
const INSTRUCTIONS =
  /\b(ignore|disregard|forget|override) (all |any )?(of )?(the |your |my )?(previous|prior|above|earlier|original) (instructions|prompts?|messages|rules)|\b(new|updated) instructions for (the |an? )?(ai|agent|assistant)\b|\bsystem prompt\b|\b(ai|llm) (agents?|assistants?)( reading this)?(,|:) (you must|please|ignore)/i;
/** Shorter text is too common to say it came from another site; codes and keys have digits. */
const MIN_CARRIED = 6;
const MIN_WORDY = 20;
const KEEP_CHARS = 200_000;

/** Pages on this machine are the user's own dev servers: acting there never asks. */
export function siteOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return undefined;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || host === '0.0.0.0') return undefined;
  return host.replace(/^www\./, '');
}

const quote = (s: string, n = 60) => JSON.stringify(s.length > n ? `${s.slice(0, n - 1)}…` : s);
const field = (t?: RefInfo) => (t ? `${t.role}${t.name ? ` ${quote(t.name)}` : ''}` : 'a field');

/**
 * Decides which agent actions stop for the user's OK, per agent connection (one run).
 * Reading and browsing never ask; typing secrets, submitting, carrying text from one site to another,
 * and acting on a page that seems to give the agent orders do, once per site unless allowed there.
 */
export class ActionGuard {
  private readonly runs = new Map<string, { allowed: Set<string>; read: Map<string, string>; orders: Set<string> }>();

  private run(connection: string) {
    let r = this.runs.get(connection);
    if (!r) this.runs.set(connection, (r = { allowed: new Set(), read: new Map(), orders: new Set() }));
    return r;
  }

  /** Remember what the agent read on a page, so text carried to another site can be spotted. */
  noteRead(connection: string, url: string | undefined, text: string) {
    const site = siteOf(url);
    if (!site || !text) return;
    const r = this.run(connection);
    const all = `${r.read.get(site) ?? ''}\n${text}`;
    r.read.delete(site);
    r.read.set(site, all.length > KEEP_CHARS ? all.slice(-KEEP_CHARS) : all);
    let total = 0;
    for (const [s, t] of [...r.read].reverse()) {
      total += t.length;
      if (total > KEEP_CHARS * 3) r.read.delete(s);
    }
    if (INSTRUCTIONS.test(text)) r.orders.add(site);
  }

  allow(connection: string, site: string) {
    this.run(connection).allowed.add(site);
  }

  end(connection: string) {
    this.runs.delete(connection);
  }

  check(connection: string, req: GuardRequest): Risk | undefined {
    const { method, params: p } = req;
    if (method === 'open' || method === 'navigate' || method === 'tabNew') {
      const url = typeof p.url === 'string' ? p.url : undefined;
      const site = siteOf(url);
      if (!site || !url) return undefined;
      const u = new URL(url);
      // Following a link it read is browsing; building an address out of what it read is how pages leak.
      const from = this.carriedFrom(connection, site, decodeURIComponentSafe(u.search + u.hash), [url, u.pathname + u.search]);
      return this.ask(
        connection,
        site,
        from
          ? {
              action: `open ${quote(url, 80)}`,
              why: `The address contains text it read on ${from}. A page can trick an agent into sending what it read to another site.`,
            }
          : undefined,
      );
    }
    const site = siteOf(req.url);
    if (!site) return undefined;
    const t = req.target;
    let risk: Omit<Risk, 'site'> | undefined;
    if (method === 'type') {
      const text = String(p.text ?? '');
      const from = this.carriedFrom(connection, site, text);
      if (t?.secret || SECRET_FIELD.test(t?.name ?? '')) {
        risk = { action: `type into the ${field(t)} on ${site}`, why: 'This field looks like it holds a password, key, code or card details.' };
      } else if (from) {
        risk = {
          action: `type ${quote(text)} into the ${field(t)} on ${site}`,
          why: `It read this text on ${from}. A page can trick an agent into sending what it read to another site.`,
        };
      } else if (p.submit) {
        risk = { action: `type into the ${field(t)} on ${site} and submit it`, why: 'Submitting sends the form to the site.' };
      }
    } else if (method === 'press' && /(^|\+)Enter$/i.test(String(p.key ?? ''))) {
      risk = { action: `press Enter on ${site}`, why: 'Enter can submit a form to the site.' };
    } else if (method === 'click' && t && SUBMIT_BUTTON.test(t.name ?? '')) {
      risk = { action: `click the ${field(t)} on ${site}`, why: 'This button looks like it sends, buys, deletes or signs up for something.' };
    }
    const acting = ['type', 'press', 'click', 'select', 'upload', 'drag'].includes(method);
    if (!risk && acting && this.run(connection).orders.has(site)) {
      risk = {
        action: `${method === 'type' ? 'type' : method} on ${site}`,
        why: 'This page has text that looks like instructions for an AI agent, which can be an attempt to take it over.',
      };
    }
    return this.ask(connection, site, risk);
  }

  private ask(connection: string, site: string, risk: Omit<Risk, 'site'> | undefined): Risk | undefined {
    if (!risk || this.run(connection).allowed.has(site)) return undefined;
    return { site, ...risk };
  }

  /** The other site, if any, where the agent read this text. */
  private carriedFrom(connection: string, site: string, text: string, links: string[] = []): string | undefined {
    const needles = text
      .split(/[\s&?=/#,;"'<>()[\]{}]+/)
      .filter(s => (s.length >= MIN_CARRIED && /\d/.test(s)) || s.length >= MIN_WORDY);
    if (!needles.length) return undefined;
    const read = this.run(connection).read;
    const here = read.get(site) ?? '';
    for (const [other, seen] of read) {
      if (other === site || links.some(l => seen.includes(l))) continue;
      if (needles.some(n => seen.includes(n) && !here.includes(n))) return other;
    }
    return undefined;
  }
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
