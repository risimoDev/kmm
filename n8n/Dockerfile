FROM alpine:3.20 AS fetcher

# Скачиваем статически собранный ffmpeg
RUN apk add --no-cache wget xz \
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
RUN apk add --no-cache fontconfig ttf-dejavu font-noto font-noto-cjk \
     && fc-cache -f -v

USER node
