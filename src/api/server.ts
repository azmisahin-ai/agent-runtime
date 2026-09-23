import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { newId } from '../domain/id.js';
import { ApiError } from './errors.js';
import type { ApiContext, Principal, RuntimeApiService } from './runtime-api.js';

export interface ApiServerOptions {
  port: number;
  host?: string;
  // Bearer token required for state-changing requests. When unset the API is
  // read-only-capable but mutations are denied (spec 09 §9, 15 §10).
  token?: string | null;
}

const MAX_BODY_BYTES = 1 * 1024 * 1024;

// HTTP+JSON transport under /api/v1 (spec 09 §1). The transport authenticates,
// parses, dispatches and serializes; all policy and state decisions live deeper.
// It never trusts a client-supplied identity or capability.
export class ApiServer {
  private readonly server: Server;

  constructor(private readonly service: RuntimeApiService, private readonly options: ApiServerOptions) {
    this.server = createServer((req, res) => { void this.handle(req, res); });
  }

  listen(): Promise<{ port: number; host: string }> {
    const host = this.options.host ?? '127.0.0.1';
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.options.port, host, () => {
        const address = this.server.address();
        const port = typeof address === 'object' && address ? address.port : this.options.port;
        resolve({ port, host });
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => this.server.close(error => (error ? reject(error) : resolve())));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestId = newId('req');
    res.setHeader('x-request-id', requestId);
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (!url.pathname.startsWith('/api/v1/')) throw new ApiError('NOT_FOUND', 'Unknown endpoint', false, { path: url.pathname });

      const method = (req.method ?? 'GET').toUpperCase();
      const segments = url.pathname.slice('/api/v1/'.length).split('/').filter(Boolean);
      const principal = this.authenticate(req, method);
      const ctx: ApiContext = { requestId, principal, idempotencyKey: this.idempotencyKey(req) };

      // SSE has its own streaming response and must not go through the JSON writer.
      if (method === 'GET' && segments.length === 4 && segments[0] === 'tasks' && segments[2] === 'events' && segments[3] === 'stream') {
        this.streamEvents(ctx, res, segments[1], url);
        return;
      }

      const body = method === 'POST' || method === 'PATCH' ? await readJsonBody(req) : {};
      const result = await this.dispatch(ctx, method, segments, body, url);
      this.writeJson(res, result.status, result.payload);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (error instanceof ApiError) {
        this.writeJson(res, error.status, error.toBody(requestId));
        return;
      }
      // Unknown errors never leak internals to clients.
      this.writeJson(res, 500, new ApiError('INTERNAL_ERROR', 'Internal error', false).toBody(requestId));
    }
  }

  private async dispatch(ctx: ApiContext, method: string, segments: string[], body: Record<string, unknown>, url: URL): Promise<{ status: number; payload: unknown }> {
    const [head, second, third] = segments;

    if (head === 'projects') {
      if (segments.length === 1) {
        if (method === 'GET') return { status: 200, payload: { projects: this.service.listProjects() } };
        if (method === 'POST') return { status: 201, payload: this.service.createProject(ctx, body) };
      }
      if (segments.length === 2) {
        if (method === 'GET') return { status: 200, payload: this.service.getProject(ctx, second) };
      }
      if (segments.length === 3 && second && third === 'tasks' && method === 'POST') {
        return { status: 201, payload: this.service.createTask(ctx, second, body) };
      }
      if (segments.length === 3 && second && third === 'memories' && method === 'GET') {
        return { status: 200, payload: { memories: this.service.listMemories(ctx, second) } };
      }
      if (segments.length === 3 && second && third === 'repository' && method === 'GET') {
        return { status: 200, payload: this.service.repositoryStatus(ctx, second) };
      }
      if (segments.length === 4 && second && third === 'repository') {
        if (method !== 'GET') throw new ApiError('NOT_FOUND', 'Unknown endpoint', false, { method });
        if (segments[3] === 'tree') return { status: 200, payload: this.service.repositoryTree(ctx, second) };
        if (segments[3] === 'diff') return { status: 200, payload: this.service.repositoryDiff(ctx, second, url.searchParams.get('against')) };
      }
    }

    if (head === 'tasks' && second === undefined && method === 'POST') {
      return { status: 201, payload: this.service.createTask(ctx, asProjectId(body), body) };
    }

    if (head === 'tasks' && second) {
      const rest = segments.slice(2);
      if (rest.length === 0 && method === 'GET') return { status: 200, payload: this.service.getTask(ctx, second) };
      if (rest.length === 1 && method === 'POST') {
        switch (rest[0]) {
          case 'start': return { status: 202, payload: this.service.startTask(ctx, second, parseRunOptions(body)) };
          case 'run': return { status: 200, payload: await this.service.runTask(ctx, second, parseRunOptions(body)) };
          case 'pause': return { status: 202, payload: this.service.pauseTask(ctx, second) };
          case 'resume': return { status: 202, payload: this.service.resumeTask(ctx, second) };
          case 'cancel': return { status: 202, payload: this.service.cancelTask(ctx, second) };
          case 'retry': return { status: 202, payload: this.service.retryTask(ctx, second) };
        }
      }
      if (rest.length === 1 && method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? '0');
        switch (rest[0]) {
          case 'events': return { status: 200, payload: { events: this.service.listEvents(ctx, second, Number.isFinite(after) ? after : 0) } };
          case 'attempts': return { status: 200, payload: { attempts: this.service.listAttempts(ctx, second) } };
          case 'checkpoints': return { status: 200, payload: { checkpoints: this.service.listCheckpoints(ctx, second) } };
          case 'tools': return { status: 200, payload: { tool_runs: this.service.listToolRuns(ctx, second, url.searchParams.get('attempt_id')) } };
          case 'evaluations': return { status: 200, payload: { evaluations: this.service.listEvaluations(ctx, second) } };
        }
      }
    }

    if (head === 'backends' && second === 'capabilities' && method === 'GET') {
      return { status: 200, payload: this.service.backendCapabilities() };
    }

    throw new ApiError('NOT_FOUND', 'Unknown endpoint', false, { method, path: segments.join('/') });
  }

  // SSE stream of task events with monotonic sequence numbers (spec 09 §6).
  private streamEvents(ctx: ApiContext, res: ServerResponse, taskId: string, url: URL): void {
    const after = Number(url.searchParams.get('after') ?? '0');
    res.writeHead(200, {
      'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive',
      'x-request-id': ctx.requestId
    });
    const events = this.service.listEvents(ctx, taskId, Number.isFinite(after) ? after : 0);
    for (const event of events) {
      res.write(`id: ${event.sequence_number}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    res.write(': stream-end\n\n');
    res.end();
  }

  // Only an authenticated client may mutate. The model and repository content are
  // never authorities (spec 09 §9, 15 §1-2).
  private authenticate(req: IncomingMessage, method: string): Principal {
    const mutating = method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
    const token = this.options.token;
    const provided = bearerToken(req);
    if (mutating) {
      if (!token) throw new ApiError('PERMISSION_DENIED', 'Mutations are disabled: no API token configured', false);
      if (provided !== token) throw new ApiError('PERMISSION_DENIED', 'Invalid or missing credentials', false);
      return 'CLIENT';
    }
    return 'CLIENT';
  }

  private idempotencyKey(req: IncomingMessage): string | null {
    const header = req.headers['idempotency-key'];
    const value = Array.isArray(header) ? header[0] : header;
    return value && value.trim().length > 0 ? value.trim() : null;
  }

  private writeJson(res: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    res.end(body);
  }
}

function asProjectId(body: Record<string, unknown>): string {
  const value = body.project_id ?? body.projectId;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiError('VALIDATION_ERROR', "Field 'project_id' must be a non-empty string", false, { field: 'project_id' });
  }
  return value;
}

function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match ? match[1].trim() : null;
}

function parseRunOptions(body: Record<string, unknown>): { allowUnknown?: boolean } {
  if ('checks' in body) {
    throw new ApiError('PERMISSION_DENIED', 'Verification checks are runtime-owned and cannot be supplied by a client', false);
  }
  return { allowUnknown: body.allow_unknown === true };
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ApiError('INVALID_REQUEST', 'Request body too large', false, { max_bytes: MAX_BODY_BYTES });
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text.length === 0) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ApiError('INVALID_REQUEST', 'Request body must be a JSON object', false);
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('INVALID_REQUEST', 'Malformed JSON body', false);
  }
}
