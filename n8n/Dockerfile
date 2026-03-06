FROM alpine:3.20 AS fetcher

# Шрифты, ffmpeg, Python3 + yt-dlp
# Python3 нужен потому что официального musl-бинарника yt-dlp не существует —
# штатный yt-dlp_linux слинкован с glibc (libpython3.13 → posix_fallocate64
# которого нет в musl), поэтому ставим через pip из Alpine/musl Python.
RUN apk add --no-cache wget xz fontconfig ttf-dejavu font-noto font-noto-cjk \
     python3 py3-pip \
     && pip3 install --break-system-packages --no-cache-dir yt-dlp \
     && yt-dlp --version \
     && wget -qO /tmp/ffmpeg.tar.xz \
     https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
     && mkdir -p /tmp/ffmpeg \
     && tar -xf /tmp/ffmpeg.tar.xz -C /tmp/ffmpeg --strip-components=1

FROM n8nio/n8n:latest

USER root

# Копируем статические бинарники ffmpeg (работают на любом Linux без зависимостей)
COPY --from=fetcher /tmp/ffmpeg/ffmpeg /usr/local/bin/ffmpeg
COPY --from=fetcher /tmp/ffmpeg/ffprobe /usr/local/bin/ffprobe

# Python3 (musl-совместимый от Alpine) + yt-dlp
# n8n тоже Alpine/musl → Python3-libs совместимы
COPY --from=fetcher /usr/bin/python3.12 /usr/bin/python3
COPY --from=fetcher /usr/lib/python3.12 /usr/lib/python3.12
COPY --from=fetcher /usr/lib/libpython3.12.so.1.0 /usr/lib/libpython3.12.so.1.0
COPY --from=fetcher /usr/bin/yt-dlp /usr/local/bin/yt-dlp

# libffi нужен для Python ctypes/ssl модулей
COPY --from=fetcher /usr/lib/libffi* /usr/lib/

RUN chmod +x /usr/local/bin/ffmpeg /usr/local/bin/ffprobe /usr/local/bin/yt-dlp \
     && ln -sf /usr/lib/libpython3.12.so.1.0 /usr/lib/libpython3.12.so

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
