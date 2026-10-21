import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MASK, RunRecorder, cleanParams, describeStep, hideKeys, type RunStep } from '../src/runRecorder';
import { agentName, renderReplay } from '../src/replayHtml';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'hai-runs-'));
  dirs.push(d);
  return d;
};
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));

const step = (over: Partial<RunStep>): Omit<RunStep, 'seq' | 'screenshot'> => ({
  method: 'click',
  tool: 'browser_click',
  startedAt: 1000,
  durationMs: 50,
  params: {},
  ...over,
});

describe('cleanParams', () => {
  it('hides text typed into secret fields', () => {
    expect(cleanParams('type', { ref: 'e3', text: 'hunter2' }, true)).toEqual({ ref: 'e3', text: MASK });
    expect(cleanParams('type', { ref: 'e3', text: 'hello' }, false)).toEqual({ ref: 'e3', text: 'hello' });
  });
  it('trims very long strings', () => {
    const out = cleanParams('evaluate', { expression: 'x'.repeat(5000) });
    expect((out.expression as string).length).toBeLessThan(2100);
  });
});

describe('hideKeys', () => {
  const cat = 'live_nA4eSUfzThS8PFpRH0x3lwXDbd98iX7XvkhtTv8V';
  it('masks strings shaped like keys and tokens', () => {
    expect(hideKeys(`Your API Key ${cat} keep it safe`)).toBe(`Your API Key ${MASK} keep it safe`);
    expect(hideKeys("-H 'x-api-key: sk-proj-abcDEF1234567890abcdef'")).toBe(`-H 'x-api-key: ${MASK}'`);
    expect(hideKeys('Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U')).toBe(`Bearer ${MASK}`);
    expect(hideKeys('token Zq8Lm2Np4Rs6Tu8Vw0Xy2Za4Bc6De8Fg0Hi')).toBe(`token ${MASK}`);
  });
  it('keeps ordinary text, ids and hashes', () => {
    const text = 'BreedsController_listBreedsByCountry e784db3c262d085f459bb9ec78e8b3b216222a3f 1f0e3dad-9990-4f4e-8e1a-2c7b3a1d5e6f a@b.co task-runner';
    expect(hideKeys(text)).toBe(text);
  });
  it('masks known values anywhere', () => {
    expect(hideKeys('pass is hunter22, yes hunter22', ['hunter22'])).toBe(`pass is ${MASK}, yes ${MASK}`);
  });
});

describe('describeStep', () => {
  it('names the element acted on', () => {
    expect(describeStep({ ...step({ target: { ref: 'e5', role: 'button', name: 'Choose Pro' } }), seq: 1 })).toBe('Click button "Choose Pro"');
    expect(describeStep({ ...step({ method: 'type', params: { text: 'a@b.co', submit: true }, target: { role: 'textbox', name: 'Email' } }), seq: 1 })).toBe(
      'Type "a@b.co" into textbox "Email" and submit',
    );
    expect(describeStep({ ...step({ params: { x: 10.4, y: 20 } }), seq: 1 })).toBe('Click (10, 20)');
    expect(describeStep({ ...step({ method: 'snapshot' }), seq: 1 })).toBe('Read the page');
  });
});

describe('RunRecorder', () => {
  it('hides a typed secret in later steps and never saves it', () => {
    const rec = new RunRecorder({ dir: tmp() });
    const run = rec.runFor('c1');
    rec.addStep(run, step({ method: 'type', params: { ref: 'e2', text: MASK } }), undefined, 'hunter22');
    rec.addStep(run, step({ method: 'snapshot', read: '- textbox "Password": hunter22', url: 'https://x.test/?k=hunter22' }));
    const saved = rec.load(run.id)!;
    expect(saved.stepList[1]).toMatchObject({ read: `- textbox "Password": ${MASK}`, url: `https://x.test/?k=${MASK}` });
    expect(readFileSync(join(run.dir, 'run.json'), 'utf8')).not.toContain('hunter22');
  });
  it('groups steps per connection and starts a new run after a long pause', () => {
    let now = 0;
    const rec = new RunRecorder({ dir: tmp(), idleMs: 1000, now: () => now });
    const a = rec.runFor('c1', 'claude-code');
    rec.addStep(a, step({ startedAt: 0 }), Buffer.from('jpeg').toString('base64'));
    now = 500;
    expect(rec.runFor('c1').id).toBe(a.id);
    expect(rec.runFor('c2').id).not.toBe(a.id);
    now = 5000;
    expect(rec.runFor('c1').id).not.toBe(a.id);
    const saved = rec.load(a.id)!;
    expect(saved.agent).toBe('claude-code');
    expect(saved.stepList[0]).toMatchObject({ seq: 1, screenshot: 'step-0001.jpg' });
    expect(readdirSync(saved.dir)).toContain('step-0001.jpg');
  });

  it('keeps only the newest runs', () => {
    let now = 0;
    const dir = tmp();
    const rec = new RunRecorder({ dir, keepRuns: 2, now: () => now });
    for (let i = 0; i < 4; i++) {
      now = i * 1000;
      rec.addStep(rec.runFor(`c${i}`), step({ startedAt: now }));
      rec.endConnection(`c${i}`);
    }
    now = 9000;
    rec.runFor('last');
    expect(readdirSync(dir).length).toBe(2);
  });

  it('deletes runs older than keepDays, also when VS Code starts', () => {
    let now = 0;
    const dir = tmp();
    const rec = new RunRecorder({ dir, keepDays: 7, now: () => now });
    rec.addStep(rec.runFor('c1'), step({ startedAt: 0 }));
    rec.endConnection('c1');
    now = 6 * 86_400_000;
    expect(new RunRecorder({ dir, keepDays: 7, now: () => now }).list()).toHaveLength(1);
    now = 8 * 86_400_000;
    expect(new RunRecorder({ dir, keepDays: 7, now: () => now }).list()).toHaveLength(0);
  });

  it('deletes the oldest runs once they take more than maxBytes', () => {
    let now = 0;
    const dir = tmp();
    const rec = new RunRecorder({ dir, maxBytes: 5000, now: () => now });
    const jpeg = Buffer.alloc(2000).toString('base64');
    for (let i = 0; i < 3; i++) {
      now = i * 1000;
      rec.addStep(rec.runFor(`c${i}`), step({ startedAt: now }), jpeg);
      rec.endConnection(`c${i}`);
    }
    now = 9000;
    const last = rec.runFor('last');
    const ids = readdirSync(dir).sort();
    expect(ids).toHaveLength(3);
    expect(ids).toContain(last.id);
    expect(rec.list().map(r => r.startedAt)).toEqual([2000, 1000]);
  });

  it('refuses ids that could escape the runs folder', () => {
    expect(new RunRecorder({ dir: tmp() }).load('../../etc')).toBeUndefined();
  });
});

describe('renderReplay', () => {
  it('embeds steps safely and labels the agent', () => {
    const rec = new RunRecorder({ dir: tmp() });
    const run = rec.runFor('c1', 'claude-code');
    rec.addStep(run, step({ title: '</script><script>alert(1)</script>', target: { name: 'Buy' } }));
    const html = renderReplay(rec.load(run.id)!, { image: f => f });
    expect(html).toContain('Claude Code run');
    expect(html).not.toContain('</script><script>alert(1)');
    expect(agentName('some-agent')).toBe('Some Agent');
  });
});
