const { randomUUID } = require('node:crypto');

function createRenewalDiagnostics({
  enabled = process.env.PULSEBOARD_RENEWAL_DIAGNOSTICS || '0',
  write = line => console.log(line),
  now = Date.now,
  heartbeatMs = 60000,
} = {}) {
  if (!['0', '1'].includes(enabled)) throw new Error('PULSEBOARD_RENEWAL_DIAGNOSTICS must be 0 or 1');
  if (enabled === '0') return undefined;
  const processId = randomUUID();
  const deadline = now() + 30 * 60 * 60 * 1000;
  const credentialsMetadata = new WeakMap();
  const connections = [];
  let tokenGeneration = 0;
  let latestToken;
  let timer;
  const emit = (event, fields = {}) => {
    if (now() > deadline) {
      clearInterval(timer);
      return;
    }
    write(JSON.stringify({
      category: 'pulseboard.redis.renewal', event, at: new Date(now()).toISOString(),
      processId, ...fields,
    }));
  };
  const metadata = () => latestToken ? { ...latestToken } : {};

  return {
    wrapCredential(credential) {
      return {
        async getToken(...args) {
          const result = await credential.getToken(...args);
          if (!Number.isFinite(result?.expiresOnTimestamp)) {
            emit('token_metadata_unavailable');
            return result;
          }
          latestToken = {
            tokenGeneration: ++tokenGeneration,
            expiresAt: new Date(result.expiresOnTimestamp).toISOString(),
          };
          emit('token_acquired', metadata());
          return result;
        },
      };
    },
    observeProvider(provider) {
      const subscribe = provider.subscribe.bind(provider);
      provider.subscribe = async listener => {
        const result = await subscribe({
          ...listener,
          onNext(credentials) {
            credentialsMetadata.set(credentials, metadata());
            emit('refresh_delivered', metadata());
            listener.onNext(credentials);
          },
        });
        credentialsMetadata.set(result[0], metadata());
        return result;
      };
    },
    async attach(redis) {
      for (const master of redis.masters) {
        const node = await redis.nodeClient(master);
        // Pinned node-redis clients wrap the transport with Object.create.
        // Observe its existing AUTH method without changing credentials or scheduling.
        const transport = Object.getPrototypeOf(node);
        if (typeof transport.reAuthenticate !== 'function') {
          throw new Error('Pinned Redis transport does not expose the expected AUTH observer');
        }
        const connectionId = randomUUID();
        const state = { connectionId, generation: 1, initialExpiresAt: latestToken?.expiresAt };
        connections.push({ state, node });
        emit('connection_authenticated', { ...state, ...metadata() });
        const reAuthenticate = transport.reAuthenticate.bind(transport);
        transport.reAuthenticate = async credentials => {
          const generation = state.generation;
          const token = credentialsMetadata.get(credentials);
          let result;
          try {
            result = await reAuthenticate(credentials);
          } catch (error) {
            emit('auth_failed', { connectionId, generation, ...token });
            throw error;
          }
          emit('auth_acknowledged', {
            connectionId, generation, ...token,
            continuous: generation === state.generation && node.isReady,
          });
          return result;
        };
        node.on('reconnecting', () => {
          state.generation++;
          emit('connection_reconnecting', { ...state });
        });
        node.on('ready', () => emit('connection_ready', { ...state }));
        node.on('end', () => emit('connection_ended', { ...state }));
        node.on('error', () => emit('connection_error', { ...state }));
      }
      const heartbeat = () => emit('heartbeat', {
        masterCount: redis.masters.length,
        connections: connections.map(({ state, node }) => ({ ...state, ready: node.isReady })),
      });
      heartbeat();
      timer = setInterval(heartbeat, heartbeatMs);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
      emit('observer_stopped');
    },
  };
}

module.exports = { createRenewalDiagnostics };
