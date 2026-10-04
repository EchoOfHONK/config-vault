FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 vault && useradd --uid 10001 --gid vault --no-create-home vault
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN python -m pip install --disable-pip-version-check --upgrade pip==26.2.0 \
    && python -m pip install --disable-pip-version-check -r requirements.txt
COPY backend/app ./app
COPY deploy/backend-entrypoint.py /usr/local/bin/vault-entrypoint
RUN chmod 755 /usr/local/bin/vault-entrypoint
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)" || exit 1
# Startup copies mounted 0600 secrets, then irrevocably drops to uid/gid 10001.
ENTRYPOINT ["/usr/bin/tini", "--", "python", "/usr/local/bin/vault-entrypoint"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
