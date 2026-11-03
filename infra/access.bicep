targetScope = 'resourceGroup'

param cacheName string
@description('Object/principal ID of the Builder app identity or the local developer, NOT client ID.')
param principalId string
param assignmentName string
@minLength(1)
@maxLength(40)
param namespace string = 'demo'

resource cache 'Microsoft.Cache/redisEnterprise@2026-09-01' existing = { name: cacheName }
resource database 'Microsoft.Cache/redisEnterprise/databases@2026-09-01' existing = {
  parent: cache
  name: 'default'
}

resource assignment 'Microsoft.Cache/redisEnterprise/databases/accessPolicyAssignments@2026-05-01-preview' = {
  parent: database
  name: assignmentName
  properties: {
    accessPolicyName: 'default'
    accessString: '+ping +echo +auth +hello +client|setinfo +client|setname +cluster|slots +cluster|shards +info +exists +get +mget +set +incr +del +ttl +zadd +zrange +zrevrange +zrevrank +zincrby +zrem +zcard +zremrangebyscore +multi +exec +discard ~pulseboard:{${namespace}}:*'
    user: { objectId: principalId }
  }
}

output assignmentId string = assignment.id
