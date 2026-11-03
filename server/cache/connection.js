const { createCluster } = require('@redis/client');
const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');
const { EntraIdCredentialsProviderFactory, REDIS_SCOPE_DEFAULT } = require('@redis/entraid');
const { isIP } = require('node:net');
const { readConfig } = require('./config');
const { createRenewalDiagnostics } = require('./renewalDiagnostics');

function createConnection({ config = readConfig(), credential, observeRefresh } = {}) {
  credential ||= config.mode === 'developer'
    ? new DefaultAzureCredential()
    : new ManagedIdentityCredential(config.clientId ? { clientId: config.clientId } : {});
  const diagnostics = createRenewalDiagnostics();
  if (diagnostics) credential = diagnostics.wrapCredential(credential);
  const provider = EntraIdCredentialsProviderFactory.createForDefaultAzureCredential({
    credential,
    scopes: REDIS_SCOPE_DEFAULT,
    tokenManagerConfig: { expirationRefreshRatio: 0.8 },
    onReAuthenticationError: err => console.error('Redis re-authentication failed:', err.message),
    onRetryableError: () => console.error('Redis token acquisition failed; retrying'),
  });
  if (observeRefresh) {
    const subscribe = provider.subscribe.bind(provider);
    provider.subscribe = listener => subscribe({
      ...listener,
      onNext(credentials) {
        observeRefresh();
        listener.onNext(credentials);
      },
    });
  }
  diagnostics?.observeProvider(provider);
  const redis = createCluster({
    rootNodes: [{ url: `rediss://${config.endpoint}` }],
    defaults: {
      credentialsProvider: provider,
      disableOfflineQueue: true,
      socket: {
        tls: true,
        servername: config.host,
        connectTimeout: 15000,
        reconnectStrategy: retries => retries < 8
          ? Math.min(200 * 2 ** retries, 5000)
          : new Error('Redis reconnect exhausted; check endpoint, identity and access assignment'),
      },
    },
    nodeAddressMap(address) {
      const separator = address.lastIndexOf(':');
      const host = address.slice(0, separator);
      return { host: isIP(host) ? config.host : host, port: Number(address.slice(separator + 1)) };
    },
  });
  redis.on('error', err => console.error('Redis cluster error:', err.message));
  return { redis, provider, config, diagnostics };
}

module.exports = { createConnection };
