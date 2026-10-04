FROM debian:13-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server nginx ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY deploy/test-ssh/entrypoint.sh /opt/fixture-entrypoint.sh
COPY deploy/test-ssh/sshd_config /opt/fixture-sshd_config
RUN chmod 755 /opt/fixture-entrypoint.sh
EXPOSE 22
ENTRYPOINT ["/opt/fixture-entrypoint.sh"]
