#!/bin/bash
# Deploy Sally Vision Backend to Google Cloud Run
# Requires: gcloud CLI authenticated, GEMINI_API_KEY set in environment

set -euo pipefail

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "Error: GEMINI_API_KEY environment variable is required"
  echo "Usage: GEMINI_API_KEY=<your-gemini-api-key> ./deploy.sh"
  exit 1
fi

echo "Deploying Sally Vision Backend to Cloud Run..."

gcloud run deploy sally-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GEMINI_API_KEY=${GEMINI_API_KEY}"

echo "Deployment complete!"
echo "Run 'gcloud run services describe sally-backend --region us-central1 --format=\"value(status.url)\"' to get the URL"
