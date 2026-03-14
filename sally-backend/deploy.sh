#!/bin/bash
# Deploy Sally Vision Backend to Google Cloud Run
# Requires: gcloud CLI authenticated, Secret Manager secret already created

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-us-central1}"
SERVICE_NAME="${SERVICE_NAME:-sally-backend}"
REPOSITORY="${REPOSITORY:-sally}"
SECRET_NAME="${SECRET_NAME:-sally-gemini-api-key}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-$(gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" --region "${REGION}" --format="value(spec.template.spec.serviceAccountName)" 2>/dev/null)}"

if [ -z "${PROJECT_ID}" ]; then
  echo "Error: gcloud project is not configured"
  echo "Usage: gcloud config set project <project-id>"
  exit 1
fi

if ! gcloud secrets describe "${SECRET_NAME}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "Error: Secret Manager secret '${SECRET_NAME}' was not found"
  echo "Create it first, then rerun this script."
  exit 1
fi

if [ -z "${RUNTIME_SERVICE_ACCOUNT}" ]; then
  RUNTIME_SERVICE_ACCOUNT="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')-compute@developer.gserviceaccount.com"
fi

IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)}"
IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"

echo "Building ${IMAGE_URI} with Cloud Build..."
gcloud builds submit \
  --project "${PROJECT_ID}" \
  --tag "${IMAGE_URI}"

echo "Deploying ${SERVICE_NAME} to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --image "${IMAGE_URI}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --service-account "${RUNTIME_SERVICE_ACCOUNT}" \
  --set-secrets "GEMINI_API_KEY=${SECRET_NAME}:latest" \
  --set-env-vars "ENABLE_CLOUD_LOGGING=true"

echo "Deployment complete!"
echo "Run 'gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format=\"value(status.url)\"' to get the URL"
