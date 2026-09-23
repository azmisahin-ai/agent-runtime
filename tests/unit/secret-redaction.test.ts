import test from 'node:test';
import assert from 'node:assert/strict';
import { containsSecret, redactSecrets, redactValue } from '../../src/security/secret-redaction.js';

test('known credential shapes are redacted', () => {
  const github = redactSecrets('token=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(github.redacted, true);
  assert.ok(!github.text.includes('ghp_abcdefghijklmnopqrstuvwxyz0123456789'));

  const aws = redactSecrets('AKIAIOSFODNN7EXAMPLE');
  assert.equal(aws.redacted, true);
  assert.ok(!aws.text.includes('AKIAIOSFODNN7EXAMPLE'));

  const jwt = redactSecrets('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U');
  assert.equal(jwt.redacted, true);
});

test('secret assignment preserves the key but redacts the value', () => {
  const report = redactSecrets('DB_PASSWORD="hunter2secret"');
  assert.equal(report.redacted, true);
  assert.ok(report.text.includes('DB_PASSWORD'));
  assert.ok(!report.text.includes('hunter2secret'));
});

test('private key blocks are fully redacted', () => {
  const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
  const report = redactSecrets(key);
  assert.equal(report.redacted, true);
  assert.ok(!report.text.includes('MIIEowIBAAKCAQEA'));
});

test('credentials embedded in URLs are redacted', () => {
  const report = redactSecrets('https://user:s3cr3tp4ss@example.com/repo.git');
  assert.equal(report.redacted, true);
  assert.ok(!report.text.includes('s3cr3tp4ss'));
});

test('ordinary prose is not flagged as a secret', () => {
  assert.equal(containsSecret('the task state machine is authoritative'), false);
  assert.equal(containsSecret('run npm run check before committing'), false);
  assert.equal(containsSecret('context limit is 8192 tokens'), false);
});

test('redactValue walks nested structures', () => {
  const value = { outer: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, list: ['ok', 'AKIAIOSFODNN7EXAMPLE'] };
  const redacted = redactValue(value);
  assert.equal(JSON.stringify(redacted).includes('ghp_'), false);
  assert.equal(JSON.stringify(redacted).includes('AKIAIOSFODNN7EXAMPLE'), false);
});
