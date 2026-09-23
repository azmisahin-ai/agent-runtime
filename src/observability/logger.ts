import { redactValue } from '../security/secret-redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

// Correlation IDs (spec 17 §2). Every structured record carries whatever subset
// the caller has, so a failure timeline is reconstructable across subsystems.
export interface CorrelationContext {
  request_id?: string | null;
  project_id?: string | null;
  task_id?: string | null;
  attempt_id?: string | null;
  session_id?: string | null;
  event_id?: string | null;
  tool_run_id?: string | null;
  context_snapshot_id?: string | null;
  config_snapshot_id?: string | null;
  checkpoint_id?: string | null;
  verification_id?: string | null;
  evaluation_id?: string | null;
}

export interface LogRecord extends CorrelationContext {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface MetricRecord {
  timestamp: string;
  name: string;
  kind: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels: Record<string, string | number>;
  context: CorrelationContext;
}

// LOG != EVENT != METRIC (spec 17 §1). This logger is diagnostic only; canonical
// history stays in the append-only event store. It must never be execution authority.
export class StructuredLogger {
  private readonly records: LogRecord[] = [];

  constructor(private readonly level: LogLevel = 'info', private readonly sink: (record: LogRecord) => void = () => {}) {}

  log(level: LogLevel, category: string, message: string, data?: Record<string, unknown>, context: CorrelationContext = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    // Secret redaction is mandatory before any log record leaves this method (spec 17 §5).
    const record: LogRecord = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message: redactValue(message),
      data: data ? redactValue(data) : undefined,
      ...context
    };
    this.records.push(record);
    this.sink(record);
  }

  debug(category: string, message: string, data?: Record<string, unknown>, context?: CorrelationContext): void { this.log('debug', category, message, data, context); }
  info(category: string, message: string, data?: Record<string, unknown>, context?: CorrelationContext): void { this.log('info', category, message, data, context); }
  warn(category: string, message: string, data?: Record<string, unknown>, context?: CorrelationContext): void { this.log('warn', category, message, data, context); }
  error(category: string, message: string, data?: Record<string, unknown>, context?: CorrelationContext): void { this.log('error', category, message, data, context); }

  // Diagnostic access for tests/tools; not canonical state.
  entries(): LogRecord[] { return [...this.records]; }
}

// In-memory metric registry. High-cardinality labels are the caller's
// responsibility; this type does not index by unbounded values (spec 17 §6).
export class MetricsRegistry {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  private readonly records: MetricRecord[] = [];

  constructor(private readonly context: CorrelationContext = {}) {}

  increment(name: string, value = 1, labels: Record<string, string | number> = {}): void {
    const key = metricKey(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + value);
    this.records.push({ timestamp: new Date().toISOString(), name, kind: 'counter', value, labels, context: this.context });
  }

  gauge(name: string, value: number, labels: Record<string, string | number> = {}): void {
    this.gauges.set(metricKey(name, labels), value);
    this.records.push({ timestamp: new Date().toISOString(), name, kind: 'gauge', value, labels, context: this.context });
  }

  observe(name: string, value: number, labels: Record<string, string | number> = {}): void {
    const key = metricKey(name, labels);
    const bucket = this.histograms.get(key) ?? [];
    bucket.push(value);
    this.histograms.set(key, bucket);
    this.records.push({ timestamp: new Date().toISOString(), name, kind: 'histogram', value, labels, context: this.context });
  }

  counterValue(name: string, labels: Record<string, string | number> = {}): number {
    return this.counters.get(metricKey(name, labels)) ?? 0;
  }

  gaugeValue(name: string, labels: Record<string, string | number> = {}): number | null {
    return this.gauges.get(metricKey(name, labels)) ?? null;
  }

  histogramValues(name: string, labels: Record<string, string | number> = {}): number[] {
    return [...(this.histograms.get(metricKey(name, labels)) ?? [])];
  }

  snapshot(): MetricRecord[] { return [...this.records]; }
}

function metricKey(name: string, labels: Record<string, string | number>): string {
  const parts = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
  return parts.length ? `${name}{${parts.join(',')}}` : name;
}
