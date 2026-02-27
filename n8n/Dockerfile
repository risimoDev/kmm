FROM alpine:3.20 AS fetcher

# Скачиваем статически собранный ffmpeg + шрифты (в hardened-образе n8n нет пакетного менеджера)
RUN apk add --no-cache wget xz fontconfig ttf-dejavu font-noto font-noto-cjk \
     && wget -qO /tmp/ffmpeg.tar.xz \
     https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
     && mkdir -p /tmp/ffmpeg \
     && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1

FROM n8nio/n8n:latest

USER root

# Копируем статические бинарники ffmpeg (работают на любом Linux без зависимостей)
COPY --from=fetcher /tmp/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=fetcher /tmp/ffmpeg/ffprobe /usr/local/bin/ffprobe
RUN chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe

# Шрифты для субтитров (кириллица, латиница, Font Discovery)
# n8nio/n8n:latest — Docker Hardened Image (Alpine без apk/apt) → копируем из fetcher
COPY --from=fetcher /usr/share/fonts /usr/share/fonts
COPY --from=fetcher /usr/bin/fc-cache /usr/local/bin/fc-cache
COPY --from=fetcher /etc/fonts /etc/fonts
COPY --from=fetcher /usr/lib/libfontconfig* /usr/lib/
COPY --from=fetcher /usr/lib/libfreetype* /usr/lib/
COPY --from=fetcher /usr/lib/libexpat* /usr/lib/
COPY --from=fetcher /usr/lib/libbz2* /usr/lib/
COPY --from=fetcher /usr/lib/libpng* /usr/lib/
COPY --from=fetcher /usr/lib/libbrotli* /usr/lib/
COPY --from=fetcher /usr/lib/libz* /usr/lib/
COPY --from=fetcher /usr/lib/libintl* /usr/lib/
RUN fc-cache -f -v || true

USER node
