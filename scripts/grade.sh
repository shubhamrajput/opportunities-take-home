#!/usr/bin/env bash
set -Eeuo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required. Install Docker Desktop or Docker Engine with Compose.' >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

docker compose up -d --wait postgres redis
docker compose build setup api worker planner test-runner
docker compose run --rm setup
docker compose up -d api worker planner
docker compose run --rm test-runner

echo 'Setup, demo seed, and test suite completed successfully.'
