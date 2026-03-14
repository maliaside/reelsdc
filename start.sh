#!/bin/bash
# Wrapper restart otomatis — bot selalu jalan 24/7
# Jika Node.js crash/mati, script ini restart dalam beberapa detik

NODE_PID=""

cleanup() {
    echo "[start.sh] SIGTERM/SIGINT diterima — menghentikan bot..."
    if [ -n "$NODE_PID" ]; then
        kill -TERM "$NODE_PID" 2>/dev/null
        wait "$NODE_PID" 2>/dev/null
    fi
    exit 143
}

trap cleanup SIGTERM SIGINT

echo "[start.sh] Memulai bot NGEDRACIN..."

while true; do
    node index.js &
    NODE_PID=$!
    wait "$NODE_PID"
    EXIT=$?
    NODE_PID=""

    echo "[start.sh] Process keluar dengan kode $EXIT"

    if [ "$EXIT" -eq "143" ] || [ "$EXIT" -eq "130" ]; then
        echo "[start.sh] Dihentikan oleh signal — keluar."
        exit "$EXIT"
    fi

    echo "[start.sh] Restart dalam 5 detik..."
    sleep 5
done
