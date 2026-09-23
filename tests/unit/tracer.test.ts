import test from 'node:test';
import assert from 'node:assert/strict';
import { Tracer, toJsonLines } from '../../src/observability/tracer.js';

test('a child span carries the same trace id and the parent span id', () => {
  const tracer = new Tracer();
  const parent = tracer.startSpan({ name: 'attempt', attributes: { task_id: 't1' } });
  const child = tracer.startSpan({ name: 'backend_request', traceId: parent.traceId, parentSpanId: parent.spanId });
  tracer.endSpan(child.spanId, 'OK');
  tracer.endSpan(parent.spanId, 'OK');

  const spans = tracer.spansFor(parent.traceId);
  assert.equal(spans.length, 2);
  const childSpan = spans.find(s => s.name === 'backend_request')!;
  assert.equal(childSpan.traceId, parent.traceId);
  assert.equal(childSpan.parentSpanId, parent.spanId);
  assert.equal(childSpan.status, 'OK');
  assert.equal(tracer.openSpanCount(), 0);
});

test('a failing sink degrades tracing only and never throws', () => {
  const tracer = new Tracer(() => { throw new Error('exporter down'); });
  const span = tracer.startSpan({ name: 'attempt' });
  // A broken exporter must not surface to the attempt being traced (spec 17 §7).
  assert.doesNotThrow(() => tracer.endSpan(span.spanId, 'OK'));
  assert.equal(tracer.sinkErrorCount(), 1);
  assert.equal(tracer.completed().length, 1, 'the span is still recorded locally');
});

test('withSpan marks ERROR and rethrows, and closes the span', async () => {
  const tracer = new Tracer();
  await assert.rejects(
    tracer.withSpan({ name: 'backend_request' }, () => { throw new Error('boom'); }),
    /boom/
  );
  const [span] = tracer.completed();
  assert.equal(span.status, 'ERROR');
  assert.equal(span.attributes.error, 'boom');
  assert.equal(tracer.openSpanCount(), 0);
});

test('span attributes obey the secret and classification boundary', () => {
  const tracer = new Tracer();
  const span = tracer.startSpan({
    name: 'backend_request',
    attributes: {
      endpoint: 'http://localhost:11434/api/generate',
      authorization: 'Bearer sk-abcdefghijklmnopqrstuvwxyz0123456789',
      env: '.env.production'
    }
  });
  tracer.endSpan(span.spanId, 'OK');
  const record = tracer.completed()[0];
  const serialized = JSON.stringify(record.attributes);
  assert.equal(serialized.includes('sk-'), false, 'secret must not reach a span');
  assert.match(record.attributes.endpoint as string, /localhost/);
  assert.equal(record.attributes.env, '[WITHHELD]');
  assert.equal(toJsonLines([record]).includes('sk-'), false);
});
