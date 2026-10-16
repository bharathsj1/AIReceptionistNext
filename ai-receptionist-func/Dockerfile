FROM mcr.microsoft.com/azure-functions/python:4-python3.11

ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    FUNCTIONS_WORKER_RUNTIME=python \
    PYTHONUNBUFFERED=1 \
    REQUIRE_AUTH_SESSION_SECRET=true \
    DATABASE_URL=sqlite:////data/app.db \
    SOCIAL_UPLOAD_DIR=/data/social_uploads

WORKDIR /home/site/wwwroot
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && pip check
COPY . .
RUN mkdir -p /data/social_uploads

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD python -c "from urllib.request import urlopen; r = urlopen('http://127.0.0.1/api/health', timeout=3); assert r.status == 200 and r.read() == b'OK'" || exit 1
# Keep the base image's entrypoint: it starts the Functions host and Python worker.
