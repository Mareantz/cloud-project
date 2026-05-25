// ============================================================
//  infra/main.bicep
//  Restaurant Reviews – Azure infrastructure
//
//  Resources provisioned:
//    - Azure Storage account (frontend static website enabled by deploy scripts)
//    - Azure Function App + Consumption plan (HTTP API + queue worker)
//    - Cosmos DB account / database / containers
//    - Storage Account + blob containers
//        (restaurant photos, review-image originals, review-image thumbnails)
//    - Storage Queue (review-image processing trigger)
//    - Log Analytics workspace + Application Insights
//
//  Deploy:
//    bash infra/deploy.sh
//    pwsh infra/deploy.ps1
//  The deploy scripts also enable static website hosting on the storage account
//  after the ARM/Bicep deployment completes.
// ============================================================

// ── Parameters ────────────────────────────────────────────────────────────────

@description('Short name prefix used to build all resource names. Keep it lowercase, 2-8 chars.')
@minLength(2)
@maxLength(8)
param appName string = 'rr'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('''
Name of the Cosmos DB database.
Must match the COSMOS_DATABASE env var used by the API.
''')
param cosmosDatabaseName string = 'restaurant-reviews'

@description('Name of the Cosmos DB container that holds restaurant documents (partition key: /city).')
param cosmosContainerRestaurants string = 'restaurants'

@description('Name of the Cosmos DB container that holds review documents (partition key: /restaurantId).')
param cosmosContainerReviews string = 'reviews'

@description('Name of the blob container used to store restaurant photos.')
param blobContainerImages string = 'restaurant-images'

@description('Name of the blob container used to store original review images.')
param blobContainerReviewImages string = 'review-images'

@description('Name of the blob container used to store auto-generated review image thumbnails.')
param blobContainerReviewThumbnails string = 'review-thumbnails'

@description('Name of the Storage Queue that triggers thumbnail generation for review images.')
param reviewImagesQueueName string = 'review-image-processing'

@description('''
Set to true to enable the Cosmos DB free tier (400 RU/s + 5 GB free forever).
Only one account per Azure subscription can use the free tier.
Free tier is NOT compatible with serverless mode – the template will automatically
switch to provisioned throughput (400 RU/s) when this is true.
''')
param enableCosmosFreeTier bool = false

// ── Variables ─────────────────────────────────────────────────────────────────

// 6-char suffix derived from the resource group ID – makes globally-unique names
// repeatable across re-deployments to the same resource group.
var uniqueSuffix = take(uniqueString(resourceGroup().id), 6)

// Resource names follow the recommended Azure abbreviation convention:
//   https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-abbreviations
var functionPlanName  = 'plan-${appName}'
var functionAppName   = 'func-${appName}-${uniqueSuffix}'
var cosmosAccountName = 'cosmos-${appName}-${uniqueSuffix}'
var storageAccountName = 'st${appName}${uniqueSuffix}'        // max 24 chars, alphanumeric only
var logAnalyticsName  = 'log-${appName}'
var appInsightsName   = 'appi-${appName}'

// ── Log Analytics workspace ───────────────────────────────────────────────────
// Application Insights (workspace-based) requires a Log Analytics workspace.

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'   // pay-per-GB; cheapest option
    }
    retentionInDays: 30   // minimum retention, keeps costs low
  }
}

// ── Application Insights ──────────────────────────────────────────────────────

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ── Storage Account ───────────────────────────────────────────────────────────
// Used for:
//   1. AzureWebJobsStorage – required by the Azure Functions runtime.
//   2. Restaurant photo uploads (Blob Storage).

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'  // locally-redundant; sufficient for a student project
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: true   // photo URLs must be publicly readable
  }
}

// Blob service (required parent resource before creating containers)
resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

// Container for restaurant photos.
// publicAccess: 'Blob' means individual blobs are publicly readable
// but the container listing is private.
resource photosContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: blobContainerImages
  properties: {
    publicAccess: 'Blob'
  }
}

// Container for original review images (uploaded by reviewers).
// Kept separate from restaurant-photos so lifecycle policies can be applied
// independently (e.g. move originals to Cool tier after 30 days).
resource reviewImagesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: blobContainerReviewImages
  properties: {
    publicAccess: 'Blob'   // public read so frontend can display originals directly
  }
}

// Container for auto-generated thumbnails produced by the queue-triggered function.
// Written by the thumbnail function after it processes each original from the queue.
resource reviewThumbnailsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
  parent: blobService
  name: blobContainerReviewThumbnails
  properties: {
    publicAccess: 'Blob'   // public read so frontend can display thumbnails directly
  }
}

// ── Storage Queue (review-image processing) ───────────────────────────────────
// When a reviewer uploads an image the API enqueues a message here.
// A queue-triggered Azure Function reads the message and generates a thumbnail,
// then writes the result to the reviewThumbnailsContainer above.
// Reuses the same Storage Account – no additional service is required.

resource queueService 'Microsoft.Storage/storageAccounts/queueServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
}

resource reviewImageQueue 'Microsoft.Storage/storageAccounts/queueServices/queues@2023-01-01' = {
  parent: queueService
  name: reviewImagesQueueName
}

// ── Cosmos DB account ─────────────────────────────────────────────────────────
// Serverless mode (default): pay per request unit consumed.
//   Good for sporadic dev/test workloads.
// Free tier mode (opt-in via enableCosmosFreeTier):
//   400 RU/s + 5 GB free, but only one account per subscription.
//   Switches automatically to provisioned throughput.

resource cosmosAccount 'Microsoft.DocumentDB/databaseAccounts@2023-11-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    enableFreeTier: enableCosmosFreeTier
    // Serverless mode is only applied when free tier is NOT enabled.
    // The ternary keeps both paths valid in a single template.
    capabilities: enableCosmosFreeTier ? [] : [
      { name: 'EnableServerless' }
    ]
    locations: [
      {
        locationName: location
        failoverPriority: 0
        isZoneRedundant: false
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'  // best balance of performance and consistency
    }
    // Disable public-network restrictions for simplicity; add IP rules when hardening.
    publicNetworkAccess: 'Enabled'
  }
}

// ── Cosmos DB database ────────────────────────────────────────────────────────

resource cosmosDatabase 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2023-11-15' = {
  parent: cosmosAccount
  name: cosmosDatabaseName
  properties: {
    resource: {
      id: cosmosDatabaseName
    }
    // Throughput is only specified for provisioned mode (free tier).
    // Serverless containers must NOT have throughput set.
    options: enableCosmosFreeTier ? {
      throughput: 400   // minimum shared throughput across all containers
    } : {}
  }
}

// ── Cosmos DB container: restaurants ─────────────────────────────────────────
// Partition key: /city
// Rationale: restaurants are filtered by city most often; city distributes
// load evenly without hot partitions.

resource restaurantsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: cosmosContainerRestaurants
  properties: {
    resource: {
      id: cosmosContainerRestaurants
      partitionKey: {
        paths: [ '/city' ]
        kind: 'Hash'
      }
    }
  }
}

// ── Cosmos DB container: reviews ──────────────────────────────────────────────
// Partition key: /restaurantId
// Rationale: all reviews for one restaurant land in the same partition,
// making "fetch all reviews for restaurant X" a cheap single-partition query.

resource reviewsContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2023-11-15' = {
  parent: cosmosDatabase
  name: cosmosContainerReviews
  properties: {
    resource: {
      id: cosmosContainerReviews
      partitionKey: {
        paths: [ '/restaurantId' ]
        kind: 'Hash'
      }
    }
  }
}

// ── Azure Functions (standalone Function App) ─────────────────────────────────
// The React frontend is hosted as a Storage Static Website and talks directly to
// this Function App over HTTPS. CORS is opened for this anonymous student
// project so the static site can call the API regardless of the final web
// endpoint chosen by Azure.

resource functionPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: functionPlanName
  location: location
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
}

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};AccountKey=${storageAccount.listKeys().keys[0].value};EndpointSuffix=${environment().suffixes.storage}'

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  properties: {
    serverFarmId: functionPlan.id
    httpsOnly: true
    reserved: true
    siteConfig: {
      minTlsVersion: '1.2'
      linuxFxVersion: 'NODE|22'
      cors: {
        allowedOrigins: [ '*' ]
        supportCredentials: false
      }
      appSettings: [
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsights.properties.ConnectionString
        }
        {
          name: 'AzureWebJobsStorage'
          value: storageConnectionString
        }
        {
          name: 'BLOB_CONNECTION_STRING'
          value: storageConnectionString
        }
        {
          name: 'BLOB_CONTAINER_NAME'
          value: blobContainerImages
        }
        {
          name: 'COSMOS_CONTAINER_RESTAURANTS'
          value: cosmosContainerRestaurants
        }
        {
          name: 'COSMOS_CONTAINER_REVIEWS'
          value: cosmosContainerReviews
        }
        {
          name: 'COSMOS_DATABASE'
          value: cosmosDatabaseName
        }
        {
          name: 'COSMOS_ENDPOINT'
          value: cosmosAccount.properties.documentEndpoint
        }
        {
          name: 'COSMOS_KEY'
          value: cosmosAccount.listKeys().primaryMasterKey
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'node'
        }
        {
          name: 'AzureWebJobsFeatureFlags'
          value: 'EnableWorkerIndexing'
        }
        {
          name: 'REVIEW_IMAGES_CONTAINER_NAME'
          value: blobContainerReviewImages
        }
        {
          name: 'REVIEW_IMAGES_QUEUE_NAME'
          value: reviewImagesQueueName
        }
        {
          name: 'REVIEW_THUMBNAILS_CONTAINER_NAME'
          value: blobContainerReviewThumbnails
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: storageConnectionString
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
      ]
    }
  }
}

// ── Outputs ───────────────────────────────────────────────────────────────────
// These are printed by `az deployment group show` and captured in the deploy scripts.

@description('Function App name used by manual deploy commands and CI/CD configuration.')
output functionAppName string = functionApp.name

@description('Default hostname of the Function App (e.g. func-rr-abc123.azurewebsites.net).')
output functionAppHostname string = functionApp.properties.defaultHostName

@description('Base URL the frontend should use when calling the Function App API.')
output functionAppApiBaseUrl string = 'https://${functionApp.properties.defaultHostName}/api'

@description('Cosmos DB endpoint URL (value of COSMOS_ENDPOINT).')
output cosmosEndpoint string = cosmosAccount.properties.documentEndpoint

@description('Storage account name (useful for az storage commands).')
output storageAccountName string = storageAccount.name

@description('Application Insights connection string (value of APPLICATIONINSIGHTS_CONNECTION_STRING).')
output appInsightsConnectionString string = appInsights.properties.ConnectionString
