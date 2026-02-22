FROM n8nio/n8n:latest

USER root

# Устанавливаем ffmpeg, python3 и шрифты напрямую в том же Alpine что и n8n
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    font-noto \
    font-noto-emoji

USER node
