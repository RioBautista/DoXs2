# Deploy DoXS API to Cloud Run

Project: `doxs2-e3d72`  
Region: `us-central1`  
Service: `doxs-api`

## Build/deploy from repo root

```bash
gcloud config set project doxs2-e3d72
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

gcloud run deploy doxs-api \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 1 \
  --max-instances 5 \
  --memory 512Mi \
  --cpu 1 \
  --set-secrets AUTH_MODE=AUTH_MODE:latest,DEV_LOGIN_MOCK=DEV_LOGIN_MOCK:latest,MYSQL_INSECURE_AUTH=MYSQL_INSECURE_AUTH:latest,SESSION_SECRET=SESSION_SECRET:latest,IDOXS_CLIENT_OXFORD_MYSQL_HOST=IDOXS_CLIENT_OXFORD_MYSQL_HOST:latest,IDOXS_CLIENT_OXFORD_MYSQL_PORT=IDOXS_CLIENT_OXFORD_MYSQL_PORT:latest,IDOXS_CLIENT_OXFORD_MYSQL_USER=IDOXS_CLIENT_OXFORD_MYSQL_USER:latest,IDOXS_CLIENT_OXFORD_MYSQL_PASSWORD=IDOXS_CLIENT_OXFORD_MYSQL_PASSWORD:latest,IDOXS_CLIENT_OXFORD_MYSQL_DATABASE=IDOXS_CLIENT_OXFORD_MYSQL_DATABASE:latest,IDOXS_CLIENT_WERT_MYSQL_HOST=IDOXS_CLIENT_WERT_MYSQL_HOST:latest,IDOXS_CLIENT_WERT_MYSQL_PORT=IDOXS_CLIENT_WERT_MYSQL_PORT:latest,IDOXS_CLIENT_WERT_MYSQL_USER=IDOXS_CLIENT_WERT_MYSQL_USER:latest,IDOXS_CLIENT_WERT_MYSQL_PASSWORD=IDOXS_CLIENT_WERT_MYSQL_PASSWORD:latest,IDOXS_CLIENT_WERT_MYSQL_DATABASE=IDOXS_CLIENT_WERT_MYSQL_DATABASE:latest,IDOXS_CLIENT_IVACORP_MYSQL_HOST=IDOXS_CLIENT_IVACORP_MYSQL_HOST:latest,IDOXS_CLIENT_IVACORP_MYSQL_PORT=IDOXS_CLIENT_IVACORP_MYSQL_PORT:latest,IDOXS_CLIENT_IVACORP_MYSQL_USER=IDOXS_CLIENT_IVACORP_MYSQL_USER:latest,IDOXS_CLIENT_IVACORP_MYSQL_PASSWORD=IDOXS_CLIENT_IVACORP_MYSQL_PASSWORD:latest,IDOXS_CLIENT_IVACORP_MYSQL_DATABASE=IDOXS_CLIENT_IVACORP_MYSQL_DATABASE:latest
```

## Verify

```bash
SERVICE_URL=$(gcloud run services describe doxs-api --region us-central1 --format 'value(status.url)')
curl -i "$SERVICE_URL/api/health"
curl -i "$SERVICE_URL/api/debug/db/oxford"
curl -i "$SERVICE_URL/api/debug/db/wert"
```

## Firebase Hosting rewrite

After Cloud Run is healthy, update `firebase.json` hosting rewrite from function to Cloud Run:

```json
{ "source": "/api/**", "run": { "serviceId": "doxs-api", "region": "us-central1" } }
```

Then:

```bash
firebase deploy --only hosting:doccs-as --project doxs2-e3d72
```
