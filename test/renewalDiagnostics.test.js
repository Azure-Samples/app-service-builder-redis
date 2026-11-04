const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRenewalDiagnostics } = require('../server/cache/renewalDiagnostics');

test('renewal diagnostics default off and reject invalid opt-in values', () => {
  assert.equal(createRenewalDiagnostics({ enabled: '0' }), undefined);
  assert.throws(() => createRenewalDiagnostics({ enabled: 'true' }), /must be 0 or 1/);
});

test('diagnostics retain original credentials, AUTH outcomes and socket continuity without leaking secrets', async () => {
  const lines = [];
  let timestamp = Date.UTC(2026, 10, 3);
  const observer = createRenewalDiagnostics({ enabled: '1', write: line => lines.push(line), now: () => timestamp });
  const first = { token: 'NEVER_LOG_TOKEN_ONE', expiresOnTimestamp: timestamp + 3600000 };
  const second = { token: 'NEVER_LOG_TOKEN_TWO', expiresOnTimestamp: timestamp + 7200000 };
  let response = first;
  const credential = observer.wrapCredential({
    async getToken(...args) {
      assert.deepEqual(args, ['scope', { abortSignal: undefined }]);
      return response;
    },
  });
  assert.equal(await credential.getToken('scope', { abortSignal: undefined }), first);
  let listener;
  const initialCredentials = { username: 'NEVER_LOG_ACCOUNT', password: first.token };
  const disposable = { dispose() {} };
  const provider = {
    async subscribe(value) {
      listener = value;
      return [initialCredentials, disposable];
    },
  };
  observer.observeProvider(provider);
  const delivered = [];
  const subscribed = await provider.subscribe({ onNext: value => delivered.push(value) });
  assert.equal(subscribed[0], initialCredentials);
  assert.equal(subscribed[1], disposable);
  const transport = new EventEmitter();
  transport.isReady = true;
  let authError;
  let authCount = 0;
  transport.reAuthenticate = async value => {
    assert.equal(value.password, second.token);
    authCount++;
    if (authError) throw authError;
    return 'OK';
  };
  const node = Object.create(transport);
  const redis = { masters: [{}], async nodeClient() { return node; } };
  try {
    await observer.attach(redis);
    response = second;
    timestamp += 1000;
    assert.equal(await credential.getToken('scope', { abortSignal: undefined }), second);
    const refreshed = { username: 'NEVER_LOG_ACCOUNT', password: second.token };
    listener.onNext(refreshed);
    assert.equal(delivered[0], refreshed);
    assert.equal(await transport.reAuthenticate(refreshed), 'OK');
    node.emit('reconnecting');
    await transport.reAuthenticate(refreshed);
    authError = new Error('NEVER_LOG_ERROR_OR_TOKEN');
    await assert.rejects(transport.reAuthenticate(refreshed), error => error === authError);
    assert.equal(authCount, 3);
    const events = lines.map(line => JSON.parse(line));
    const initial = events.find(event => event.event === 'connection_authenticated');
    assert.equal(initial.initialExpiresAt, new Date(first.expiresOnTimestamp).toISOString());
    const acknowledgements = events.filter(event => event.event === 'auth_acknowledged');
    assert.equal(acknowledgements.length, 2);
    assert.equal(acknowledgements[0].expiresAt, new Date(second.expiresOnTimestamp).toISOString());
    assert.equal(acknowledgements[0].connectionId, initial.connectionId);
    assert.equal(acknowledgements[0].generation, initial.generation);
    assert.equal(acknowledgements[1].generation, 2);
    assert.equal(events.filter(event => event.event === 'auth_failed').length, 1);
    assert.equal(new Set(events.map(event => event.processId)).size, 1);
    assert.ok(events.some(event => event.event === 'heartbeat'));
    assert.doesNotMatch(lines.join('\n'), /NEVER_LOG|password|username|accessToken/);
  } finally {
    observer.stop();
  }
});

test('credential failures propagate unchanged and never emit error payloads', async () => {
  const lines = [];
  const observer = createRenewalDiagnostics({ enabled: '1', write: line => lines.push(line) });
  const error = new Error('SECRET_TOKEN_IN_ERROR');
  const credential = observer.wrapCredential({ async getToken() { throw error; } });
  await assert.rejects(credential.getToken('scope'), value => value === error);
  assert.deepEqual(lines, []);
  const noMetadata = observer.wrapCredential({ async getToken() { return null; } });
  assert.equal(await noMetadata.getToken('scope'), null);
  assert.equal(JSON.parse(lines[0]).event, 'token_metadata_unavailable');
});
