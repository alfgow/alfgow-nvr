#!/usr/bin/env bash

set -e

APP_DIR="/home/alfgow/alfgow-nvr-app"
CONTAINER_NAME="alfgow-nvr"

echo "🚀 Deploy Alfgow NVR"

cd "$APP_DIR"

echo "📥 Descargando cambios..."
git pull origin main

echo "🛑 Bajando contenedor anterior..."
docker compose down || true

echo "🔨 Construyendo imagen..."
docker compose build --no-cache

echo "🟢 Levantando contenedor..."
docker compose up -d

echo "🧹 Limpiando imágenes no usadas..."
docker image prune -f

echo "✅ Deploy terminado"
docker ps --filter "name=$CONTAINER_NAME"