export class SchemaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

interface SchemaNode {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  required?: string[];
  properties?: Record<string, SchemaNode>;
  additionalProperties?: boolean;
  items?: SchemaNode;
  enum?: readonly unknown[];
  maxLength?: number;
  minLength?: number;
  minimum?: number;
  maximum?: number;
}

// Minimal, dependency-free JSON-schema subset validator. Tool arguments are
// untrusted intent and must be validated before any policy or execution step.
export function validateArguments(schema: Record<string, unknown>, args: unknown): void {
  validateNode(schema as SchemaNode, args, '$');
}

function validateNode(schema: SchemaNode, value: unknown, path: string): void {
  if (!schema || typeof schema !== 'object') return;

  if (schema.enum && !schema.enum.includes(value)) {
    throw new SchemaValidationError(`${path}: value ${JSON.stringify(value)} is not in enum`);
  }

  if (schema.type) {
    const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    const expected = schema.type;
    const matches = expected === 'integer'
      ? typeof value === 'number' && Number.isInteger(value)
      : actual === expected;
    if (!matches) throw new SchemaValidationError(`${path}: expected ${expected}, got ${actual}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) throw new SchemaValidationError(`${path}: below minLength`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) throw new SchemaValidationError(`${path}: exceeds maxLength`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) throw new SchemaValidationError(`${path}: below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) throw new SchemaValidationError(`${path}: exceeds maximum`);
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validateNode(schema.items as SchemaNode, item, `${path}[${index}]`));
  }

  if (schema.type === 'object' || schema.properties) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in record)) throw new SchemaValidationError(`${path}: missing required property '${key}'`);
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(record)) {
      if (properties[key]) validateNode(properties[key], child, `${path}.${key}`);
      else if (schema.additionalProperties === false) throw new SchemaValidationError(`${path}: unexpected property '${key}'`);
    }
  }
}
