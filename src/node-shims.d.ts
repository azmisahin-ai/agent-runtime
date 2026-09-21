declare const process: { env: Record<string, string | undefined> };
declare module "node:path" { export const resolve: (...parts: string[]) => string; export const dirname: (p: string) => string; export const join: (...parts: string[]) => string; }
declare module "node:crypto" { export function randomUUID(): string; }
declare module "node:fs" { export function mkdirSync(path: string, options?: unknown): void; export function readFileSync(path: string, encoding: string): string; export function mkdtempSync(prefix: string): string; export function rmSync(path: string, options?: unknown): void; export function existsSync(path: string): boolean; }
declare module "node:os" { export function tmpdir(): string; }
declare module "node:sqlite" { export class DatabaseSync { constructor(path: string); exec(sql: string): void; prepare(sql: string): any; close(): void; } }
declare module "node:test" { const test: any; export default test; }
declare module "node:assert/strict" { const assert: any; export default assert; }
