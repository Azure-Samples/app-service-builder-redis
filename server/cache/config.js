function readConfig(env = process.env) {
  const endpoint = env.REDIS_ENDPOINT;
  if (!endpoint || !/^[a-zA-Z0-9.-]+:\d+$/.test(endpoint)) {
    throw new Error('REDIS_ENDPOINT must be hostname:port from Azure Managed Redis (no URL or credentials)');
  }
  const [host, portText] = endpoint.split(':');
  const port = Number(portText);
  if (port < 1 || port > 65535) throw new Error('REDIS_ENDPOINT port must be 1-65535');
  const namespace = env.REDIS_NAMESPACE ?? 'demo';
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(namespace)) {
    throw new Error('REDIS_NAMESPACE must contain 1-40 letters, digits, underscores or hyphens');
  }
  const mode = env.REDIS_AUTH_MODE ?? 'managed-identity';
  if (!['managed-identity', 'developer'].includes(mode)) {
    throw new Error('REDIS_AUTH_MODE must be managed-identity or developer');
  }
  if (mode === 'developer' && (env.IDENTITY_ENDPOINT || env.MSI_ENDPOINT || env.WEBSITE_INSTANCE_ID)) {
    throw new Error('Developer authentication is local-only; use managed-identity in Azure');
  }
  return { endpoint, host, port, namespace, mode, clientId: env.AZURE_CLIENT_ID };
}

function keyPrefix(namespace) {
  // A shared hash tag keeps each sample's transactions on one OSS cluster slot.
  return `pulseboard:{${namespace}}:`;
}

module.exports = { readConfig, keyPrefix };
