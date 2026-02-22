FROM alpine:3.22 AS builder

RUN apk add --no-cache \
    ffmpeg \
    python3 \
    font-noto

FROM n8nio/n8n:latest

USER root

COPY --from=builder /usr/bin/ffmpeg /usr/bin/ffmpeg
COPY --from=builder /usr/bin/ffprobe /usr/bin/ffprobe
COPY --from=builder /usr/bin/python3 /usr/bin/python3
COPY --from=builder /usr/lib/python3* /usr/lib/python3.12/
COPY --from=builder /usr/lib/libpython3* /usr/lib/
COPY --from=builder /usr/lib/libavcodec* /usr/lib/
COPY --from=builder /usr/lib/libavformat* /usr/lib/
COPY --from=builder /usr/lib/libavutil* /usr/lib/
COPY --from=builder /usr/lib/libswresample* /usr/lib/
COPY --from=builder /usr/lib/libswscale* /usr/lib/
COPY --from=builder /usr/lib/libavfilter* /usr/lib/
COPY --from=builder /usr/lib/libavdevice* /usr/lib/
COPY --from=builder /usr/lib/libpostproc* /usr/lib/
COPY --from=builder /usr/share/fonts/noto /usr/share/fonts/noto

USER node
