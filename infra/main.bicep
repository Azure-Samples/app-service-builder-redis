targetScope = 'resourceGroup'

@description('Unique name for a NEW Azure Managed Redis instance; do not target an existing cache.')
param cacheName string
@description('Keep Redis aligned with the public customer Builder region. Validate B0 capacity before provisioning.')
param location string = 'westus2'

@description('Balanced B0 is the economical development/test tier. No automatic larger-SKU fallback.')
param skuName string = 'Balanced_B0'

resource cache 'Microsoft.Cache/redisEnterprise@2026-09-01' = {
  name: cacheName
  location: location
  sku: { name: skuName }
  tags: {
    sample: 'app-service-builder-redis'
    environment: 'devtest'
    cleanup: 'review-before-delete'
  }
  properties: {
    publicNetworkAccess: 'Enabled'
    minimumTlsVersion: '1.2'
    highAvailability: 'Disabled'
    encryption: {}
  }
}

resource database 'Microsoft.Cache/redisEnterprise/databases@2026-09-01' = {
  parent: cache
  name: 'default'
  properties: {
    accessKeysAuthentication: 'Disabled'
    clientProtocol: 'Encrypted'
    clusteringPolicy: 'OSSCluster'
    evictionPolicy: 'NoEviction'
    port: 10000
    modules: []
  }
}

output redisResourceId string = cache.id
output redisEndpoint string = '${cache.properties.hostName}:${database.properties.port}'
