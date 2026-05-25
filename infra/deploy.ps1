param(
  [string]$AzureResourceGroup = $(if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { 'rg-restreviews' }),
  [string]$AzureLocation = $(if ($env:AZURE_LOCATION) { $env:AZURE_LOCATION } else { 'auto' }),
  [string]$AppName = $(if ($env:APP_NAME) { $env:APP_NAME } else { 'rr' }),
  [bool]$CosmosFreeTier = $(if ($env:COSMOS_FREE_TIER) { [System.Convert]::ToBoolean($env:COSMOS_FREE_TIER) } else { $false })
)

$ErrorActionPreference = 'Stop'
if ($null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)) {
  $PSNativeCommandUseErrorActionPreference = $true
}

$preferredRegionOrder = @(
  'italynorth'
  'francecentral'
  'germanywestcentral'
  'northeurope'
  'westeurope'
  'swedencentral'
  'eastus2'
  'centralus'
  'westus2'
  'eastasia'
)
$supportedRegionCandidates = @()
$AzureLocation = $AzureLocation.ToLowerInvariant()
$autoSelectLocation = $AzureLocation -eq 'auto'
$resourceGroupLocation = $AzureLocation

function Info([string]$Message) {
  Write-Host '[info] ' -ForegroundColor Cyan -NoNewline
  Write-Host $Message
}

function Success([string]$Message) {
  Write-Host '[ok]   ' -ForegroundColor Green -NoNewline
  Write-Host $Message
}

function Warn([string]$Message) {
  Write-Host '[warn] ' -ForegroundColor Yellow -NoNewline
  Write-Host $Message
}

function Step([string]$Message) {
  Write-Host ''
  Write-Host "== $Message ==" -ForegroundColor White
}

function Get-NormalizedLocationName([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $null
  }

  return (($Value.ToLowerInvariant()) -replace '\s+', '')
}

function Get-OrderedDistinctLocations([string[]]$Candidates) {
  $locationSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($candidate in @($Candidates)) {
    $normalizedCandidate = Get-NormalizedLocationName $candidate
    if ($normalizedCandidate) {
      [void]$locationSet.Add($normalizedCandidate)
    }
  }

  if ($locationSet.Count -eq 0) {
    return @()
  }

  $orderedLocations = New-Object 'System.Collections.Generic.List[string]'
  foreach ($preferredLocation in $preferredRegionOrder) {
    if ($locationSet.Remove($preferredLocation)) {
      $orderedLocations.Add($preferredLocation)
    }
  }

  foreach ($remainingLocation in (@($locationSet) | Sort-Object)) {
    $orderedLocations.Add($remainingLocation)
  }

  return $orderedLocations.ToArray()
}

function Get-LocationIntersection([string[]]$Left, [string[]]$Right) {
  if (@($Left).Count -eq 0 -or @($Right).Count -eq 0) {
    return @()
  }

  $rightSet = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($location in @($Right)) {
    $normalizedLocation = Get-NormalizedLocationName $location
    if ($normalizedLocation) {
      [void]$rightSet.Add($normalizedLocation)
    }
  }

  $intersection = foreach ($location in @($Left)) {
    $normalizedLocation = Get-NormalizedLocationName $location
    if ($normalizedLocation -and $rightSet.Contains($normalizedLocation)) {
      $normalizedLocation
    }
  }

  return Get-OrderedDistinctLocations $intersection
}

function Get-AzureAccountLocations {
  $locationsJson = az account list-locations `
    --query "[?metadata.regionType=='Physical'].name" `
    --output json 2>$null

  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($locationsJson)) {
    return @()
  }

  try {
    $locations = $locationsJson | ConvertFrom-Json -Depth 5
  }
  catch {
    return @()
  }

  return Get-OrderedDistinctLocations @($locations)
}

function Resolve-EffectiveLocationConstraints([object[]]$ConstraintSets) {
  if (@($ConstraintSets).Count -eq 0) {
    return @()
  }

  $effectiveLocations = @($ConstraintSets[0].Locations)
  for ($index = 1; $index -lt $ConstraintSets.Count; $index++) {
    $effectiveLocations = Get-LocationIntersection $effectiveLocations $ConstraintSets[$index].Locations
    if (@($effectiveLocations).Count -eq 0) {
      break
    }
  }

  return Get-OrderedDistinctLocations $effectiveLocations
}

function Get-PolicyLocationConstraints {
  $assignmentsJson = az policy assignment list `
    --query "[].{displayName:displayName,policyDefinitionId:policyDefinitionId,parameters:parameters}" `
    --output json 2>$null

  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($assignmentsJson)) {
    return [pscustomobject]@{
      ResourceLocations = @()
      ResourceGroupLocations = @()
    }
  }

  try {
    $assignments = $assignmentsJson | ConvertFrom-Json -Depth 20
  }
  catch {
    return [pscustomobject]@{
      ResourceLocations = @()
      ResourceGroupLocations = @()
    }
  }

  $resourceConstraintSets = New-Object 'System.Collections.Generic.List[object]'
  $resourceGroupConstraintSets = New-Object 'System.Collections.Generic.List[object]'

  foreach ($assignment in @($assignments)) {
    if ($null -eq $assignment.parameters) {
      continue
    }

    $displayName = [string]$assignment.displayName
    $policyDefinitionId = [string]$assignment.policyDefinitionId
    foreach ($parameter in $assignment.parameters.PSObject.Properties) {
      $parameterName = [string]$parameter.Name
      if ($parameterName -notmatch '^(listOfAllowedLocations|listOfAllowedLocationsForResourcesAndResourceGroups|listOfAllowedLocationsForResourceGroups|allowedLocations|allowedLocationsForResourceGroups)$') {
        continue
      }

      $parameterValue = $parameter.Value
      if ($null -eq $parameterValue -or $null -eq $parameterValue.value) {
        continue
      }

      $locations = Get-OrderedDistinctLocations @($parameterValue.value)
      if (@($locations).Count -eq 0) {
        continue
      }

      $targetScope =
        if ($parameterName -match 'resourcesandresourcegroups' -or $displayName -match 'resources and resource groups') {
          'Both'
        }
        elseif ($parameterName -match 'resourcegroups' -or $displayName -match 'resource groups') {
          'ResourceGroup'
        }
        else {
          'Resource'
        }

      $constraint = [pscustomobject]@{
        Source = if ([string]::IsNullOrWhiteSpace($displayName)) { $policyDefinitionId } else { $displayName }
        Locations = $locations
      }

      switch ($targetScope) {
        'Both' {
          $resourceConstraintSets.Add($constraint)
          $resourceGroupConstraintSets.Add($constraint)
        }
        'ResourceGroup' {
          $resourceGroupConstraintSets.Add($constraint)
        }
        default {
          $resourceConstraintSets.Add($constraint)
        }
      }
    }
  }

  return [pscustomobject]@{
    ResourceLocations = Resolve-EffectiveLocationConstraints $resourceConstraintSets
    ResourceGroupLocations = Resolve-EffectiveLocationConstraints $resourceGroupConstraintSets
  }
}

function Initialize-AutoLocationCandidates {
  $accountLocations = Get-AzureAccountLocations
  $policyConstraints = Get-PolicyLocationConstraints

  $resourceLocations =
    if (@($policyConstraints.ResourceLocations).Count -gt 0) {
      if (@($accountLocations).Count -gt 0) {
        Get-LocationIntersection $policyConstraints.ResourceLocations $accountLocations
      }
      else {
        @($policyConstraints.ResourceLocations)
      }
    }
    elseif (@($accountLocations).Count -gt 0) {
      Get-OrderedDistinctLocations @($preferredRegionOrder + $accountLocations)
    }
    else {
      @($preferredRegionOrder)
    }

  if (@($resourceLocations).Count -eq 0) {
    throw 'Azure location discovery found no usable deployment regions for resources.'
  }

  $resourceGroupLocations =
    if (@($policyConstraints.ResourceGroupLocations).Count -gt 0) {
      if (@($accountLocations).Count -gt 0) {
        Get-LocationIntersection $policyConstraints.ResourceGroupLocations $accountLocations
      }
      else {
        @($policyConstraints.ResourceGroupLocations)
      }
    }
    else {
      @($resourceLocations)
    }

  if (@($resourceGroupLocations).Count -eq 0) {
    $resourceGroupLocations = @($resourceLocations)
  }

  if (@($policyConstraints.ResourceLocations).Count -gt 0) {
    Info "Azure Policy allowed resource locations: $($resourceLocations -join ', ')"
  }
  elseif (@($accountLocations).Count -gt 0) {
    Info "Discovered $($accountLocations.Count) Azure subscription locations; probing Europe-first first."
  }
  else {
    Warn 'Could not read Azure subscription locations; falling back to the built-in preferred region list.'
  }

  if (@($policyConstraints.ResourceGroupLocations).Count -gt 0) {
    Info "Azure Policy allowed resource group locations: $($resourceGroupLocations -join ', ')"
  }

  return [pscustomobject]@{
    ResourceLocations = @($resourceLocations)
    ResourceGroupLocations = @($resourceGroupLocations)
  }
}

function Get-ValidationSummary([string]$Output) {
  if ([string]::IsNullOrWhiteSpace($Output)) {
    return 'No validation details were returned by Azure CLI.'
  }

  $meaningfulLine =
    ($Output -split '\r?\n' |
      ForEach-Object { $_.Trim() } |
      Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and
        $_ -ne 'Succeeded' -and
        $_ -notmatch '^WARNING:' -and
        $_ -notmatch 'Warning BCP\d+'
      } |
      Select-Object -First 1)

  if (-not [string]::IsNullOrWhiteSpace($meaningfulLine)) {
    return $meaningfulLine
  }

  $firstNonEmptyLine =
    ($Output -split '\r?\n' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -First 1)

  if ([string]::IsNullOrWhiteSpace($firstNonEmptyLine)) {
    return 'No validation details were returned by Azure CLI.'
  }

  return $firstNonEmptyLine.Trim()
}

function Test-TemplateLocation([string]$CandidateLocation) {
  $hadPreferenceVariable =
    $null -ne (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue)
  $previousPreference = $null

  if ($hadPreferenceVariable) {
    $previousPreference = $PSNativeCommandUseErrorActionPreference
    $PSNativeCommandUseErrorActionPreference = $false
  }

  try {
    $output = az deployment group validate `
      --resource-group $AzureResourceGroup `
      --template-file $bicepFile `
      --parameters "@$paramsFile" `
      --parameters "appName=$AppName" "location=$CandidateLocation" "enableCosmosFreeTier=$cosmosFreeTierValue" `
      --only-show-errors `
      --query properties.provisioningState `
      --output tsv 2>&1
    $exitCode = $LASTEXITCODE
  }
  finally {
    if ($hadPreferenceVariable) {
      $PSNativeCommandUseErrorActionPreference = $previousPreference
    }
  }

  $renderedOutput = ($output | Out-String).Trim()
  $provisioningState =
    ($renderedOutput -split '\r?\n' |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
      Select-Object -Last 1)
  [pscustomobject]@{
    Succeeded = ($exitCode -eq 0 -and $provisioningState -eq 'Succeeded')
    ExitCode = $exitCode
    Output = $renderedOutput
    ProvisioningState = $provisioningState
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$bicepFile = Join-Path $scriptDir 'main.bicep'
$paramsFile = Join-Path $scriptDir 'parameters.json'
$deploymentName = "restreviews-$(Get-Date -Format 'yyyyMMddHHmmss')"
$cosmosFreeTierValue = $CosmosFreeTier.ToString().ToLowerInvariant()

Write-Host ''
Write-Host '  Restaurant Reviews - Deploy to Azure' -ForegroundColor White
Write-Host ''
Info "Resource group : $AzureResourceGroup"
Info "Location       : $AzureLocation"
Info "App name       : $AppName"
Info "Cosmos free    : $cosmosFreeTierValue"
Info "Deployment     : $deploymentName"

Step '1 / 5  Verifying Azure CLI login'

$subscriptionId = az account show --query id -o tsv 2>$null
if (-not $subscriptionId) {
  throw 'Not logged in to Azure CLI. Run: az login'
}

$subscriptionName = az account show --query name -o tsv
Success "Logged in - subscription: $subscriptionName ($subscriptionId)"

if ($autoSelectLocation) {
  $discoveredLocations = Initialize-AutoLocationCandidates
  $supportedRegionCandidates = @($discoveredLocations.ResourceLocations)
  $resourceGroupLocation = @($discoveredLocations.ResourceGroupLocations)[0]
}

Step '2 / 5  Ensuring resource group exists'

$groupExists = az group exists --name $AzureResourceGroup
if ($groupExists -eq 'true') {
  Info "Resource group '$AzureResourceGroup' already exists - skipping creation."
}
else {
  Info "Creating resource group '$AzureResourceGroup' in '$resourceGroupLocation'..."
  az group create `
    --name $AzureResourceGroup `
    --location $resourceGroupLocation `
    --output none
  Success 'Resource group created.'
}

Step '3 / 5  Validating Bicep template'

if ($autoSelectLocation) {
  $selectedValidation = $null
  $failedValidations = @()

  foreach ($candidateLocation in $supportedRegionCandidates) {
    Info "Trying Azure location '$candidateLocation'..."
    $candidateValidation = Test-TemplateLocation $candidateLocation
    if ($candidateValidation.Succeeded) {
      $AzureLocation = $candidateLocation
      $selectedValidation = $candidateValidation
      Success "Using Azure location '$AzureLocation'"
      break
    }

    $failedValidations += [pscustomobject]@{
      Location = $candidateLocation
      Summary = Get-ValidationSummary $candidateValidation.Output
    }
    Warn "Location '$candidateLocation' failed validation."
  }

  if ($null -eq $selectedValidation) {
    $failureDetails = $failedValidations | ForEach-Object { "  - $($_.Location): $($_.Summary)" }
    throw "Could not find a working Azure location. Tried: $($supportedRegionCandidates -join ', ')`n$($failureDetails -join "`n")"
  }
}
else {
  $validation = Test-TemplateLocation $AzureLocation
  if (-not $validation.Succeeded) {
    throw "Bicep template validation failed for location '$AzureLocation'.`n$($validation.Output)"
  }
}

Success 'Template is valid.'

Step '4 / 5  Deploying resources (this takes 3-8 minutes)'
Warn 'Cosmos DB, the Function App, and the Storage Account provision slowly - please be patient.'

$deploymentState = az deployment group create `
  --name $deploymentName `
  --resource-group $AzureResourceGroup `
  --template-file $bicepFile `
  --parameters "@$paramsFile" `
  --parameters "appName=$AppName" "location=$AzureLocation" "enableCosmosFreeTier=$cosmosFreeTierValue" `
  --query properties.provisioningState `
  --output tsv

if ($deploymentState -ne 'Succeeded') {
  throw "Azure deployment finished with provisioning state '$deploymentState'."
}

Success 'Deployment complete.'

Step '5 / 5  Configuring static website and reading deployment outputs'

function Get-RequiredDeploymentOutput([string]$Name) {
  $value = az deployment group show `
    --name $deploymentName `
    --resource-group $AzureResourceGroup `
    --query "properties.outputs.$Name.value" `
    --output tsv 2>$null

  if ([string]::IsNullOrWhiteSpace($value) -or $value -eq '(null)') {
    throw "Deployment output '$Name' was not returned."
  }

  return $value
}

$functionAppName = Get-RequiredDeploymentOutput 'functionAppName'
$functionAppHostname = Get-RequiredDeploymentOutput 'functionAppHostname'
$functionAppApiBaseUrl = Get-RequiredDeploymentOutput 'functionAppApiBaseUrl'
$cosmosEndpoint = Get-RequiredDeploymentOutput 'cosmosEndpoint'
$storageAccount = Get-RequiredDeploymentOutput 'storageAccountName'
$appInsightsConnectionString = Get-RequiredDeploymentOutput 'appInsightsConnectionString'
$storageConnectionString = az storage account show-connection-string `
  --name $storageAccount `
  --resource-group $AzureResourceGroup `
  --only-show-errors `
  --query connectionString `
  --output tsv 2>$null

if ([string]::IsNullOrWhiteSpace($storageConnectionString) -or $storageConnectionString -eq '(null)') {
  throw "Could not read the storage account connection string for '$storageAccount'."
}

Info "Enabling static website hosting on storage account '$storageAccount'..."
az storage blob service-properties update `
  --connection-string $storageConnectionString `
  --static-website true `
  --index-document index.html `
  --404-document index.html `
  --only-show-errors `
  --output none

$staticWebsiteUrl = az storage account show `
  --name $storageAccount `
  --resource-group $AzureResourceGroup `
  --only-show-errors `
  --query primaryEndpoints.web `
  --output tsv 2>$null

if ([string]::IsNullOrWhiteSpace($staticWebsiteUrl) -or $staticWebsiteUrl -eq '(null)') {
  throw "Could not read the static website URL for storage account '$storageAccount' after enabling static website hosting."
}

Write-Host ''
Write-Host 'Deployment successful!' -ForegroundColor Green
Write-Host ''
Write-Host '  Static website URL'
Write-Host "    $staticWebsiteUrl"
Write-Host ''
Write-Host '  Function App'
Write-Host "    $functionAppName"
Write-Host "    https://$functionAppHostname"
Write-Host ''
Write-Host '  Function App API base URL'
Write-Host "    $functionAppApiBaseUrl"
Write-Host ''
Write-Host '  Cosmos DB endpoint'
Write-Host "    $cosmosEndpoint"
Write-Host ''
Write-Host '  Storage account'
Write-Host "    $storageAccount"
Write-Host ''
Write-Host '  App Insights connection string'
Write-Host "    $appInsightsConnectionString"
Write-Host ''

Write-Host '  Next step - publish the API to the Function App:' -ForegroundColor Yellow
Write-Host ''
Write-Host "    Set-Location '$repoRoot\api'"
Write-Host '    npm ci'
Write-Host '    npm run build'
Write-Host "    npx func azure functionapp publish '$functionAppName' --build remote"
Write-Host ''
Write-Host '  Then build and upload the frontend static site:' -ForegroundColor Yellow
Write-Host ''
Write-Host "    Set-Location '$repoRoot\frontend'"
Write-Host '    npm ci'
Write-Host "    `$env:VITE_API_BASE_URL='$functionAppApiBaseUrl'"
Write-Host "    `$env:VITE_APPLICATIONINSIGHTS_CONNECTION_STRING='$appInsightsConnectionString'"
Write-Host '    npm run build'
Write-Host '    Remove-Item Env:VITE_API_BASE_URL -ErrorAction SilentlyContinue'
Write-Host '    Remove-Item Env:VITE_APPLICATIONINSIGHTS_CONNECTION_STRING -ErrorAction SilentlyContinue'
Write-Host "    Set-Location '$repoRoot'"
Write-Host "    `$storageConnectionString = az storage account show-connection-string --name '$storageAccount' --resource-group '$AzureResourceGroup' --query connectionString -o tsv"
Write-Host "    az storage blob upload-batch --connection-string `$storageConnectionString --destination '`$web' --source frontend/dist --overwrite"
Write-Host ''
Write-Host '  GitHub Actions secrets to configure:' -ForegroundColor Yellow
Write-Host ''
Write-Host "    AZURE_FUNCTION_APP_NAME=$functionAppName"
Write-Host '    AZURE_FUNCTIONAPP_PUBLISH_PROFILE=<output of command below>'
Write-Host '    AZURE_STORAGE_CONNECTION_STRING=<output of command below>'
Write-Host "    VITE_APPLICATIONINSIGHTS_CONNECTION_STRING=$appInsightsConnectionString   # optional"
Write-Host ''
Write-Host "    az functionapp deployment list-publishing-profiles --name '$functionAppName' --resource-group '$AzureResourceGroup' --xml"
Write-Host "    az storage account show-connection-string --name '$storageAccount' --resource-group '$AzureResourceGroup' --query connectionString -o tsv"
Write-Host ''
Write-Host '  Keep the publish profile and storage connection string secret.' -ForegroundColor Yellow
