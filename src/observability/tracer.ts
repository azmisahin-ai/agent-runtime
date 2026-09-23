import { randomUUID } from 'node:crypto';
import type { CorrelationContext } from './logger.js';
import { redactValue } from '../security/secret-redaction.js';
import { canEgress, classifyData } from '../security/data-classification.js';

// Traces (spec 17 §7). A span records execution timing and causal relationships;
// canonical execution history stays in the append-only event store. A trace
// outage must therefore never erase canonical state: nothing here is authority,
// every write is best-effort, and a failing sink degrades tracing only.
export interface SpanRecord {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'OK' | 'ERROR';
  attributes: Record<string, string | number | boolean>;
  context: CorrelationContext;
}

export interface StartSpanInput {
  name: string;
  traceId?: string;
  parentSpanId?: string | null;
  attributes?: Record<string, string | number | boolean>;
  context?: CorrelationContext;
}

export interface ActiveSpan {
  spanId: string;
  traceId: string;
  parentSpanId: string | null;
  name: string;
}

export type SpanSink = (span: SpanRecord) => void;

export interface TraceExporter {
  export(spans: SpanRecord[]): void;
}

// Traces are diagnostics, not history. A sink that throws must not break the
// attempt that is being traced, so failures are counted and swallowed.
export class Tracer {
  private readonly spans: SpanRecord[] = [];
  private readonly open = new Map<string, { span: ActiveSpan; startedMs: number; attributes: Record<string, string | number | boolean>; context: CorrelationContext }>();
  private droppedSinkErrors = 0;

  constructor(private readonly sink: SpanSink = () => {}) {}

  startSpan(input: StartSpanInput): ActiveSpan {
    const spanId = `span_${randomUUID()}`;
    const traceId = input.traceId ?? `trace_${randomUUID()}`;
    const parentSpanId = input.parentSpanId ?? null;
    const span: ActiveSpan = { spanId, traceId, parentSpanId, name: input.name };
    this.open.set(spanId, {
      span,
      startedMs: Date.now(),
      attributes: sanitizeAttributes(input.attributes ?? {}),
      context: input.context ?? {}
    });
    return span;
  }

  endSpan(spanId: string, status: 'OK' | 'ERROR' = 'OK', attributes: Record<string, string | number | boolean> = {}): SpanRecord | null {
    const active = this.open.get(spanId);
    if (!active) return null;
    this.open.delete(spanId);
    const endedMs = Date.now();
    const record: SpanRecord = {
      spanId: active.span.spanId,
      traceId: active.span.traceId,
      parentSpanId: active.span.parentSpanId,
      name: active.span.name,
      startedAt: new Date(active.startedMs).toISOString(),
      endedAt: new Date(endedMs).toISOString(),
      durationMs: endedMs - active.startedMs,
      status,
      attributes: { ...active.attributes, ...sanitizeAttributes(attributes) },
      context: active.context
    };
    this.spans.push(record);
    try {
      this.sink(record);
    } catch {
      // A broken exporter degrades observability, never execution (spec 17 §7).
      this.droppedSinkErrors += 1;
    }
    return record;
  }

  // Convenience for synchronous work; the span is closed even when the body throws.
  async withSpan<T>(input: StartSpanInput, body: (span: ActiveSpan) => Promise<T> | T): Promise<T> {
    const span = this.startSpan(input);
    try {
      const result = await body(span);
      this.endSpan(span.spanId, 'OK');
      return result;
    } catch (error) {
      this.endSpan(span.spanId, 'ERROR', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  spansFor(traceId: string): SpanRecord[] {
    return this.spans.filter(span => span.traceId === traceId);
  }

  completed(): SpanRecord[] { return [...this.spans]; }

  openSpanCount(): number { return this.open.size; }

  sinkErrorCount(): number { return this.droppedSinkErrors; }
}

// Exporter that emits a flat, dependency-free structure. It is deliberately not
// wired to any vendor: the runtime owns the trace shape, operators choose a sink.
export function toJsonLines(spans: SpanRecord[]): string {
  return spans.map(span => JSON.stringify(span)).join('\n');
}

// Span attributes are telemetry: they must obey the same secret and
// classification boundary as logs (spec 15 §12, 17 §5). A value that would be
// refused by the log channel is replaced by a marker instead of being exported.
function sanitizeAttributes(attributes: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  const output: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value !== 'string') { output[key] = value; continue; }
    if (!canEgress('log', classifyData({ content: `${key} ${value}` })).allowed) { output[key] = '[WITHHELD]'; continue; }
    output[key] = redactValue(value);
  }
  return output;
}
