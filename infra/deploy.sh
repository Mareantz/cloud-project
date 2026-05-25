#!/usr/bin/env bash
# ============================================================
#  infra/deploy.sh
#  Provisions (or updates) all Azure resources for the
#  Restaurant Reviews app using the Bicep template.
#
#  Prerequisites:
#    - Azure CLI installed and logged in  (az login)
#    - Bash 4+  (macOS: brew install bash | Windows: Git Bash or WSL)
#
#  Usage:
#    bash infra/deploy.sh [options]
#
#  Options (override env vars or defaults):
#    AZURE_RESOURCE_GROUP   Resource group name   (default: rg-restreviews)
#    AZURE_LOCATION         Azure region          (default: auto; discovers policy/subscription regions, prefers Europe-first)
#    APP_NAME               Short name prefix     (default: rr)
#    COSMOS_FREE_TIER       Enable Cosmos free tier: true|false (default: false)
#
#  Examples:
#    bash infra/deploy.sh
#    AZURE_LOCATION=auto bash infra/deploy.sh
#    COSMOS_FREE_TIER=true bash infra/deploy.sh
# ============================================================

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[info]${RESET}  $*"; }
success() { echo -e "${GREEN}[ok]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET}  $*"; }
error()   { echo -e "${RED}[error]${RESET} $*" >&2; }
step()    { echo -e "\n${BOLD}── $* ${RESET}"; }

# ── Configuration ─────────────────────────────────────────────────────────────
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-restreviews}"
LOCATION="${AZURE_LOCATION:-auto}"
APP_NAME="${APP_NAME:-rr}"
COSMOS_FREE_TIER="${COSMOS_FREE_TIER:-false}"
PREFERRED_LOCATION_ORDER=(italynorth francecentral germanywestcentral northeurope westeurope swedencentral eastus2 centralus westus2 eastasia)
CANDIDATE_LOCATIONS=()
RESOURCE_GROUP_CANDIDATE_LOCATIONS=()
AUTO_SELECT_LOCATION=false
RESOURCE_GROUP_LOCATION=""
VALIDATION_OUTPUT=""
VALIDATION_FAILURES=()
ACCOUNT_LOCATIONS=()
RESOURCE_POLICY_CONSTRAINTS=()
RESOURCE_GROUP_POLICY_CONSTRAINTS=()

# Resolve paths relative to this script so it works from any working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BICEP_FILE="${SCRIPT_DIR}/main.bicep"
PARAMS_FILE="${SCRIPT_DIR}/parameters.json"

DEPLOYMENT_NAME="restreviews-$(date +%Y%m%d%H%M%S)"

# ── Banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   Restaurant Reviews  –  Deploy to Azure     ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${RESET}"
info "Resource group : ${RESOURCE_GROUP}"
info "Location       : ${LOCATION}"
info "App name       : ${APP_NAME}"
info "Cosmos free    : ${COSMOS_FREE_TIER}"
info "Deployment     : ${DEPLOYMENT_NAME}"

LOCATION="$(printf '%s' "${LOCATION}" | tr '[:upper:]' '[:lower:]')"
if [[ "${LOCATION}" == "auto" ]]; then
  AUTO_SELECT_LOCATION=true
else
  RESOURCE_GROUP_LOCATION="${LOCATION}"
fi

normalize_location() {
  local value="${1:-}"
  value="${value,,}"
  value="${value//[[:space:]]/}"
  [[ -n "${value}" ]] && printf '%s\n' "${value}"
}

ordered_unique_locations() {
  local value
  local normalized
  declare -A seen=()
  local ordered=()

  for value in "$@"; do
    normalized="$(normalize_location "${value}")"
    [[ -z "${normalized}" ]] && continue
    seen["${normalized}"]=1
  done

  if ((${#seen[@]} == 0)); then
    return 0
  fi

  for value in "${PREFERRED_LOCATION_ORDER[@]}"; do
    if [[ -n "${seen[$value]+x}" ]]; then
      ordered+=("${value}")
      unset 'seen[$value]'
    fi
  done

  if ((${#seen[@]} > 0)); then
    while IFS= read -r value; do
      ordered+=("${value}")
    done < <(printf '%s\n' "${!seen[@]}" | sort)
  fi

  printf '%s\n' "${ordered[@]}"
}

intersect_locations() {
  local left_name="$1"
  local right_name="$2"
  declare -n left_ref="${left_name}"
  declare -n right_ref="${right_name}"
  local value
  local normalized
  declare -A right_set=()
  local intersection=()

  for value in "${right_ref[@]}"; do
    normalized="$(normalize_location "${value}")"
    [[ -n "${normalized}" ]] && right_set["${normalized}"]=1
  done

  for value in "${left_ref[@]}"; do
    normalized="$(normalize_location "${value}")"
    if [[ -n "${normalized}" && -n "${right_set[$normalized]+x}" ]]; then
      intersection+=("${normalized}")
    fi
  done

  ordered_unique_locations "${intersection[@]}"
}

load_account_locations() {
  local output
  local raw_locations=()

  output=$(az account list-locations --query "[?metadata.regionType=='Physical'].name" --output tsv 2>/dev/null || true)
  ACCOUNT_LOCATIONS=()
  [[ -z "${output}" ]] && return

  while IFS= read -r line; do
    [[ -n "${line}" ]] && raw_locations+=("${line}")
  done <<< "${output}"

  mapfile -t ACCOUNT_LOCATIONS < <(ordered_unique_locations "${raw_locations[@]}")
}

classify_policy_scope_from_display() {
  local display_name="${1,,}"
  if [[ "${display_name}" == *"resources and resource groups"* ]]; then
    printf '%s\n' "both"
  elif [[ "${display_name}" == *"resource groups"* ]]; then
    printf '%s\n' "resourceGroup"
  else
    printf '%s\n' "resource"
  fi
}

add_policy_constraint() {
  local target_scope="$1"
  local locations_csv="$2"
  local raw_locations=()
  local normalized_locations=()
  local encoded_locations

  IFS=',' read -r -a raw_locations <<< "${locations_csv}"
  mapfile -t normalized_locations < <(ordered_unique_locations "${raw_locations[@]}")
  if ((${#normalized_locations[@]} == 0)); then
    return
  fi

  encoded_locations=$(IFS=,; printf '%s' "${normalized_locations[*]}")
  case "${target_scope}" in
    both)
      RESOURCE_POLICY_CONSTRAINTS+=("${encoded_locations}")
      RESOURCE_GROUP_POLICY_CONSTRAINTS+=("${encoded_locations}")
      ;;
    resourceGroup)
      RESOURCE_GROUP_POLICY_CONSTRAINTS+=("${encoded_locations}")
      ;;
    *)
      RESOURCE_POLICY_CONSTRAINTS+=("${encoded_locations}")
      ;;
  esac
}

load_policy_constraints() {
  local display_name
  local locations_csv
  local target_scope

  RESOURCE_POLICY_CONSTRAINTS=()
  RESOURCE_GROUP_POLICY_CONSTRAINTS=()

  while IFS=$'\t' read -r display_name locations_csv; do
    [[ -z "${locations_csv}" ]] && continue
    target_scope="$(classify_policy_scope_from_display "${display_name}")"
    add_policy_constraint "${target_scope}" "${locations_csv}"
  done < <(az policy assignment list --query "[?parameters.listOfAllowedLocations].{displayName:displayName,locations:join(',', parameters.listOfAllowedLocations.value)}" --output tsv 2>/dev/null || true)

  while IFS=$'\t' read -r display_name locations_csv; do
    [[ -z "${locations_csv}" ]] && continue
    add_policy_constraint "both" "${locations_csv}"
  done < <(az policy assignment list --query "[?parameters.listOfAllowedLocationsForResourcesAndResourceGroups].{displayName:displayName,locations:join(',', parameters.listOfAllowedLocationsForResourcesAndResourceGroups.value)}" --output tsv 2>/dev/null || true)

  while IFS=$'\t' read -r display_name locations_csv; do
    [[ -z "${locations_csv}" ]] && continue
    add_policy_constraint "resourceGroup" "${locations_csv}"
  done < <(az policy assignment list --query "[?parameters.listOfAllowedLocationsForResourceGroups].{displayName:displayName,locations:join(',', parameters.listOfAllowedLocationsForResourceGroups.value)}" --output tsv 2>/dev/null || true)

  while IFS=$'\t' read -r display_name locations_csv; do
    [[ -z "${locations_csv}" ]] && continue
    target_scope="$(classify_policy_scope_from_display "${display_name}")"
    add_policy_constraint "${target_scope}" "${locations_csv}"
  done < <(az policy assignment list --query "[?parameters.allowedLocations].{displayName:displayName,locations:join(',', parameters.allowedLocations.value)}" --output tsv 2>/dev/null || true)

  while IFS=$'\t' read -r display_name locations_csv; do
    [[ -z "${locations_csv}" ]] && continue
    add_policy_constraint "resourceGroup" "${locations_csv}"
  done < <(az policy assignment list --query "[?parameters.allowedLocationsForResourceGroups].{displayName:displayName,locations:join(',', parameters.allowedLocationsForResourceGroups.value)}" --output tsv 2>/dev/null || true)
}

resolve_effective_policy_locations() {
  local constraints_name="$1"
  declare -n constraints_ref="${constraints_name}"
  local effective=()
  local current=()
  local index

  if ((${#constraints_ref[@]} == 0)); then
    return 0
  fi

  IFS=',' read -r -a effective <<< "${constraints_ref[0]}"
  for ((index = 1; index < ${#constraints_ref[@]}; index++)); do
    IFS=',' read -r -a current <<< "${constraints_ref[$index]}"
    mapfile -t effective < <(intersect_locations effective current)
    if ((${#effective[@]} == 0)); then
      break
    fi
  done

  printf '%s\n' "${effective[@]}"
}

initialize_auto_location_candidates() {
  local policy_resource_locations=()
  local policy_resource_group_locations=()

  load_account_locations
  load_policy_constraints

  mapfile -t policy_resource_locations < <(resolve_effective_policy_locations RESOURCE_POLICY_CONSTRAINTS)
  mapfile -t policy_resource_group_locations < <(resolve_effective_policy_locations RESOURCE_GROUP_POLICY_CONSTRAINTS)

  if ((${#policy_resource_locations[@]} > 0)); then
    if ((${#ACCOUNT_LOCATIONS[@]} > 0)); then
      mapfile -t CANDIDATE_LOCATIONS < <(intersect_locations policy_resource_locations ACCOUNT_LOCATIONS)
    else
      CANDIDATE_LOCATIONS=("${policy_resource_locations[@]}")
    fi
  elif ((${#ACCOUNT_LOCATIONS[@]} > 0)); then
    mapfile -t CANDIDATE_LOCATIONS < <(ordered_unique_locations "${PREFERRED_LOCATION_ORDER[@]}" "${ACCOUNT_LOCATIONS[@]}")
  else
    CANDIDATE_LOCATIONS=("${PREFERRED_LOCATION_ORDER[@]}")
  fi

  if ((${#CANDIDATE_LOCATIONS[@]} == 0)); then
    error "Azure location discovery found no usable deployment regions for resources."
    exit 1
  fi

  if ((${#policy_resource_group_locations[@]} > 0)); then
    if ((${#ACCOUNT_LOCATIONS[@]} > 0)); then
      mapfile -t RESOURCE_GROUP_CANDIDATE_LOCATIONS < <(intersect_locations policy_resource_group_locations ACCOUNT_LOCATIONS)
    else
      RESOURCE_GROUP_CANDIDATE_LOCATIONS=("${policy_resource_group_locations[@]}")
    fi
  else
    RESOURCE_GROUP_CANDIDATE_LOCATIONS=("${CANDIDATE_LOCATIONS[@]}")
  fi

  if ((${#RESOURCE_GROUP_CANDIDATE_LOCATIONS[@]} == 0)); then
    RESOURCE_GROUP_CANDIDATE_LOCATIONS=("${CANDIDATE_LOCATIONS[@]}")
  fi

  RESOURCE_GROUP_LOCATION="${RESOURCE_GROUP_CANDIDATE_LOCATIONS[0]}"

  if ((${#policy_resource_locations[@]} > 0)); then
    info "Azure Policy allowed resource locations: ${CANDIDATE_LOCATIONS[*]}"
  elif ((${#ACCOUNT_LOCATIONS[@]} > 0)); then
    info "Discovered ${#ACCOUNT_LOCATIONS[@]} Azure subscription locations; probing Europe-first first."
  else
    warn "Could not read Azure subscription locations; falling back to the built-in preferred region list."
  fi

  if ((${#policy_resource_group_locations[@]} > 0)); then
    info "Azure Policy allowed resource group locations: ${RESOURCE_GROUP_CANDIDATE_LOCATIONS[*]}"
  fi
}

validation_summary() {
  local output="${1:-}"
  local line

  if [[ -z "${output}" ]]; then
    printf '%s\n' "No validation details were returned by Azure CLI."
    return
  fi

  while IFS= read -r line; do
    if [[ -n "${line//[[:space:]]/}" &&
          "${line}" != "Succeeded" &&
          "${line}" != WARNING:* &&
          "${line}" != *"Warning BCP"* ]]; then
      printf '%s\n' "${line}"
      return
    fi
  done <<< "${output}"

  printf '%s\n' "No validation details were returned by Azure CLI."
}

test_template_location() {
  local candidate_location="$1"
  local output
  local exit_code
  local provisioning_state=""

  set +e
  output=$(az deployment group validate \
    --resource-group "${RESOURCE_GROUP}" \
    --template-file  "${BICEP_FILE}" \
    --parameters     "@${PARAMS_FILE}" \
    --parameters     appName="${APP_NAME}" \
                     location="${candidate_location}" \
                     enableCosmosFreeTier="${COSMOS_FREE_TIER}" \
    --only-show-errors \
    --query          properties.provisioningState \
    --output         tsv 2>&1)
  exit_code=$?
  set -e

  VALIDATION_OUTPUT="${output}"
  while IFS= read -r line; do
    [[ -n "${line//[[:space:]]/}" ]] && provisioning_state="${line}"
  done <<< "${output}"

  [[ ${exit_code} -eq 0 && "${provisioning_state}" == "Succeeded" ]]
}

# ── Step 1: verify Azure CLI login ────────────────────────────────────────────
step "1 / 5  Verifying Azure CLI login"

if ! az account show --query id -o tsv &>/dev/null; then
  error "Not logged in to Azure CLI.  Run:  az login"
  exit 1
fi

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
success "Logged in – subscription: ${SUBSCRIPTION_NAME} (${SUBSCRIPTION_ID})"

if [[ "${AUTO_SELECT_LOCATION}" == true ]]; then
  initialize_auto_location_candidates
fi

# ── Step 2: create resource group ─────────────────────────────────────────────
step "2 / 5  Ensuring resource group exists"

if az group show --name "${RESOURCE_GROUP}" &>/dev/null; then
  info "Resource group '${RESOURCE_GROUP}' already exists – skipping creation."
else
  info "Creating resource group '${RESOURCE_GROUP}' in '${RESOURCE_GROUP_LOCATION}'…"
  az group create \
    --name "${RESOURCE_GROUP}" \
    --location "${RESOURCE_GROUP_LOCATION}" \
    --output none
  success "Resource group created."
fi

# ── Step 3: validate the Bicep template ───────────────────────────────────────
step "3 / 5  Validating Bicep template"

if [[ "${AUTO_SELECT_LOCATION}" == true ]]; then
  selected_location=""
  VALIDATION_FAILURES=()
  for candidate_location in "${CANDIDATE_LOCATIONS[@]}"; do
    info "Trying Azure location '${candidate_location}'..."
    if test_template_location "${candidate_location}"; then
      LOCATION="${candidate_location}"
      selected_location="${candidate_location}"
      success "Using Azure location '${LOCATION}'"
      break
    fi

    VALIDATION_FAILURES+=("${candidate_location}: $(validation_summary "${VALIDATION_OUTPUT}")")
    warn "Location '${candidate_location}' failed validation."
  done

  if [[ -z "${selected_location}" ]]; then
    error "Could not find a working Azure location. Tried: ${CANDIDATE_LOCATIONS[*]}"
    if ((${#VALIDATION_FAILURES[@]} > 0)); then
      printf '  - %s\n' "${VALIDATION_FAILURES[@]}" >&2
    fi
    [[ -n "${VALIDATION_OUTPUT}" ]] && printf '%s\n' "${VALIDATION_OUTPUT}" >&2
    exit 1
  fi
else
  if ! test_template_location "${LOCATION}"; then
    error "Bicep template validation failed for location '${LOCATION}'."
    [[ -n "${VALIDATION_OUTPUT}" ]] && printf '%s\n' "${VALIDATION_OUTPUT}" >&2
    exit 1
  fi
fi

success "Template is valid."

# ── Step 4: deploy ────────────────────────────────────────────────────────────
step "4 / 5  Deploying resources (this takes 3-8 minutes)"
warn "Cosmos DB, the Function App, and the Storage Account provision slowly – please be patient."

DEPLOYMENT_STATE=$(az deployment group create \
  --name            "${DEPLOYMENT_NAME}" \
  --resource-group  "${RESOURCE_GROUP}" \
  --template-file   "${BICEP_FILE}" \
  --parameters      "@${PARAMS_FILE}" \
  --parameters      appName="${APP_NAME}" \
                    location="${LOCATION}" \
                    enableCosmosFreeTier="${COSMOS_FREE_TIER}" \
  --query           properties.provisioningState \
  --output          tsv)

if [[ "${DEPLOYMENT_STATE}" != "Succeeded" ]]; then
  error "Azure deployment finished with provisioning state '${DEPLOYMENT_STATE}'."
  exit 1
fi

success "Deployment complete."

# ── Step 5: capture and display outputs ───────────────────────────────────────
step "5 / 5  Configuring static website and reading deployment outputs"

get_required_output() {
  local value
  value=$(az deployment group show \
    --name           "${DEPLOYMENT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query          "properties.outputs.${1}.value" \
    --output         tsv 2>/dev/null)

  if [[ -z "${value}" || "${value}" == "(null)" ]]; then
    error "Deployment output '${1}' was not returned."
    exit 1
  fi

  printf '%s' "${value}"
}

FUNCTION_APP_NAME=$(get_required_output "functionAppName")
FUNCTION_APP_HOSTNAME=$(get_required_output "functionAppHostname")
FUNCTION_APP_API_BASE_URL=$(get_required_output "functionAppApiBaseUrl")
COSMOS_ENDPOINT=$(get_required_output "cosmosEndpoint")
STORAGE_ACCOUNT=$(get_required_output "storageAccountName")
APPINSIGHTS_CS=$(get_required_output "appInsightsConnectionString")
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
  --name "${STORAGE_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --only-show-errors \
  --query connectionString \
  --output tsv 2>/dev/null)

if [[ -z "${STORAGE_CONNECTION_STRING}" || "${STORAGE_CONNECTION_STRING}" == "(null)" ]]; then
  error "Could not read the storage account connection string for '${STORAGE_ACCOUNT}'."
  exit 1
fi

info "Enabling static website hosting on storage account '${STORAGE_ACCOUNT}'..."
az storage blob service-properties update \
  --connection-string "${STORAGE_CONNECTION_STRING}" \
  --static-website true \
  --index-document index.html \
  --404-document index.html \
  --only-show-errors \
  --output none

STATIC_WEBSITE_URL=$(az storage account show \
  --name "${STORAGE_ACCOUNT}" \
  --resource-group "${RESOURCE_GROUP}" \
  --only-show-errors \
  --query primaryEndpoints.web \
  --output tsv 2>/dev/null)

if [[ -z "${STATIC_WEBSITE_URL}" || "${STATIC_WEBSITE_URL}" == "(null)" ]]; then
  error "Could not read the static website URL for storage account '${STORAGE_ACCOUNT}' after enabling static website hosting."
  exit 1
fi

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}  Deployment successful!${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  ${BOLD}Static website URL${RESET}"
echo    "    ${STATIC_WEBSITE_URL}"
echo ""
echo -e "  ${BOLD}Function App${RESET}"
echo    "    ${FUNCTION_APP_NAME}"
echo    "    https://${FUNCTION_APP_HOSTNAME}"
echo ""
echo -e "  ${BOLD}Function App API base URL${RESET}"
echo    "    ${FUNCTION_APP_API_BASE_URL}"
echo ""
echo -e "  ${BOLD}Cosmos DB endpoint${RESET}"
echo    "    ${COSMOS_ENDPOINT}"
echo ""
echo -e "  ${BOLD}Storage account${RESET}"
echo    "    ${STORAGE_ACCOUNT}"
echo ""
echo -e "  ${BOLD}App Insights connection string${RESET}"
echo    "    ${APPINSIGHTS_CS}"
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "${YELLOW}  ⚠  Next step – publish the API to the Function App:${RESET}"
echo ""
echo    "  1. Build and publish the API:"
echo    "       cd api && npm ci && npm run build"
echo    "       npx func azure functionapp publish '${FUNCTION_APP_NAME}' --build remote"
echo ""
echo -e "${YELLOW}  ⚠  Then build and upload the frontend static site:${RESET}"
echo ""
echo    "  2. Build the frontend (injecting App Insights at build time):"
echo    "       cd frontend && npm ci && \\"
echo    "       VITE_API_BASE_URL='${FUNCTION_APP_API_BASE_URL}' \\"
echo    "       VITE_APPLICATIONINSIGHTS_CONNECTION_STRING='${APPINSIGHTS_CS}' npm run build && cd .."
echo ""
echo    "  3. Upload the built site to the \$web container:"
echo    "       STORAGE_CONNECTION_STRING=\$(az storage account show-connection-string \\"
echo    "         --name '${STORAGE_ACCOUNT}' \\"
echo    "         --resource-group '${RESOURCE_GROUP}' \\"
echo    "         --query connectionString -o tsv)"
echo    "       az storage blob upload-batch \\"
echo    "         --connection-string \"\$STORAGE_CONNECTION_STRING\" \\"
echo    "         --destination '\$web' \\"
echo    "         --source frontend/dist \\"
echo    "         --overwrite"
echo ""
echo -e "${YELLOW}  ⚠  GitHub Actions secrets to configure:${RESET}"
echo    "       AZURE_FUNCTION_APP_NAME=${FUNCTION_APP_NAME}"
echo    "       AZURE_FUNCTIONAPP_PUBLISH_PROFILE=<output of command below>"
echo    "       AZURE_STORAGE_CONNECTION_STRING=<output of command below>"
echo    "       VITE_APPLICATIONINSIGHTS_CONNECTION_STRING=${APPINSIGHTS_CS}   # optional"
echo ""
echo    "       az functionapp deployment list-publishing-profiles \\"
echo    "         --name '${FUNCTION_APP_NAME}' \\"
echo    "         --resource-group '${RESOURCE_GROUP}' \\"
echo    "         --xml"
echo ""
echo    "       az storage account show-connection-string \\"
echo    "         --name '${STORAGE_ACCOUNT}' \\"
echo    "         --resource-group '${RESOURCE_GROUP}' \\"
echo    "         --query connectionString -o tsv"
echo ""
echo -e "${YELLOW}  ⚠  Keep the publish profile and storage connection string secret.${RESET}"
echo ""
