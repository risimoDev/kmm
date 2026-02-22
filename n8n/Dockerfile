FROM n8nio/n8n:latest

USER root

# n8nio/n8n:latest основан на Debian — используем apt-get
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    fonts-noto \
  && rm -rf /var/lib/apt/lists/*

USER node
