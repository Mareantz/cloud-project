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
#    AZURE_LOCATION         Azure region          (default: australiaeast)
#    APP_NAME               Short name prefix     (default: rr)
#    COSMOS_FREE_TIER       Enable Cosmos free tier: true|false (default: false)
#
#  Examples:
#    bash infra/deploy.sh
#    AZURE_LOCATION=eastus bash infra/deploy.sh
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
LOCATION="${AZURE_LOCATION:-australiaeast}"
APP_NAME="${APP_NAME:-rr}"
COSMOS_FREE_TIER="${COSMOS_FREE_TIER:-false}"

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

# ── Step 1: verify Azure CLI login ────────────────────────────────────────────
step "1 / 5  Verifying Azure CLI login"

if ! az account show --query id -o tsv &>/dev/null; then
  error "Not logged in to Azure CLI.  Run:  az login"
  exit 1
fi

SUBSCRIPTION_ID=$(az account show --query id -o tsv)
SUBSCRIPTION_NAME=$(az account show --query name -o tsv)
success "Logged in – subscription: ${SUBSCRIPTION_NAME} (${SUBSCRIPTION_ID})"

# ── Step 2: create resource group ─────────────────────────────────────────────
step "2 / 5  Ensuring resource group exists"

if az group show --name "${RESOURCE_GROUP}" &>/dev/null; then
  info "Resource group '${RESOURCE_GROUP}' already exists – skipping creation."
else
  info "Creating resource group '${RESOURCE_GROUP}' in '${LOCATION}'…"
  az group create \
    --name "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --output none
  success "Resource group created."
fi

# ── Step 3: validate the Bicep template ───────────────────────────────────────
step "3 / 5  Validating Bicep template"

az deployment group validate \
  --resource-group "${RESOURCE_GROUP}" \
  --template-file  "${BICEP_FILE}" \
  --parameters     "@${PARAMS_FILE}" \
  --parameters     appName="${APP_NAME}" \
                   location="${LOCATION}" \
                   enableCosmosFreeTier="${COSMOS_FREE_TIER}" \
  --output none

success "Template is valid."

# ── Step 4: deploy ────────────────────────────────────────────────────────────
step "4 / 5  Deploying resources (this takes 3-8 minutes)"
warn "Cosmos DB and Static Web Apps provision slowly – please be patient."

az deployment group create \
  --name            "${DEPLOYMENT_NAME}" \
  --resource-group  "${RESOURCE_GROUP}" \
  --template-file   "${BICEP_FILE}" \
  --parameters      "@${PARAMS_FILE}" \
  --parameters      appName="${APP_NAME}" \
                    location="${LOCATION}" \
                    enableCosmosFreeTier="${COSMOS_FREE_TIER}" \
  --output none

success "Deployment complete."

# ── Step 5: capture and display outputs ───────────────────────────────────────
step "5 / 5  Reading deployment outputs"

get_output() {
  az deployment group show \
    --name           "${DEPLOYMENT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --query          "properties.outputs.${1}.value" \
    --output         tsv 2>/dev/null || echo "(not available)"
}

SWA_HOSTNAME=$(get_output "staticWebAppHostname")
DEPLOYMENT_TOKEN=$(get_output "staticWebAppDeploymentToken")
COSMOS_ENDPOINT=$(get_output "cosmosEndpoint")
STORAGE_ACCOUNT=$(get_output "storageAccountName")
APPINSIGHTS_CS=$(get_output "appInsightsConnectionString")

echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo -e "${GREEN}  Deployment successful!${RESET}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${RESET}"
echo ""
echo -e "  ${BOLD}Static Web App URL${RESET}"
echo    "    https://${SWA_HOSTNAME}"
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
echo -e "${YELLOW}  ⚠  Next step – deploy the app to your Static Web App:${RESET}"
echo ""
echo    "  1. Build the frontend:"
echo    "       cd frontend && npm run build && cd .."
echo ""
echo    "  2. Deploy using SWA CLI:"
echo    "       swa deploy frontend/dist \\"
echo    "         --api-location api \\"
echo    "         --deployment-token '${DEPLOYMENT_TOKEN}'"
echo ""
echo -e "${YELLOW}  ⚠  Keep the deployment token above secret.${RESET}"
echo -e "${YELLOW}     Store it in a GitHub Actions secret (SWA_DEPLOYMENT_TOKEN) for CI/CD.${RESET}"
echo ""
