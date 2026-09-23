import test from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRegistry, StructuredLogger } from '../../src/observability/logger.js';

test('logs are secret-redacted before they leave the logger', () => {
  const logger = new StructuredLogger('debug');
  logger.info('BACKEND', 'request used token ghp_abcdefghijklmnopqrstuvwxyz0123456789', { api_key: 'sk-abcdefghijklmnopqrstuvwxyz0123456789' });
  const entries = logger.entries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].message.includes('ghp_'), false);
  assert.equal(JSON.stringify(entries[0].data).includes('sk-'), false);
});

test('log level filtering drops lower-severity records', () => {
  const logger = new StructuredLogger('warn');
  logger.debug('X', 'ignored');
  logger.info('X', 'ignored');
  logger.warn('X', 'kept');
  assert.equal(logger.entries().length, 1);
  assert.equal(logger.entries()[0].level, 'warn');
});

test('correlation ids are carried on log records', () => {
  const logger = new StructuredLogger('debug');
  logger.info('TOOL', 'tool denied', { tool: 'terminal.exec' }, { task_id: 't1', attempt_id: 'a1', tool_run_id: 'tr1' });
  const record = logger.entries()[0];
  assert.equal(record.task_id, 't1');
  assert.equal(record.attempt_id, 'a1');
  assert.equal(record.tool_run_id, 'tr1');
});

test('metrics accumulate counters, gauges and histograms', () => {
  const metrics = new MetricsRegistry();
  metrics.increment('runtime.attempts_total', 1, { outcome: 'SUCCESS' });
  metrics.increment('runtime.attempts_total', 1, { outcome: 'SUCCESS' });
  metrics.increment('runtime.attempts_total', 1, { outcome: 'FAILURE' });
  metrics.gauge('runtime.queue_depth', 3);
  metrics.observe('runtime.attempt_duration_ms', 120);
  metrics.observe('runtime.attempt_duration_ms', 80);

  assert.equal(metrics.counterValue('runtime.attempts_total', { outcome: 'SUCCESS' }), 2);
  assert.equal(metrics.counterValue('runtime.attempts_total', { outcome: 'FAILURE' }), 1);
  assert.equal(metrics.gaugeValue('runtime.queue_depth'), 3);
  assert.deepEqual(metrics.histogramValues('runtime.attempt_duration_ms'), [120, 80]);
});
