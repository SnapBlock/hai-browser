import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MASK, RunRecorder, cleanParams, describeStep, type RunStep } from '../src/runRecorder';
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
