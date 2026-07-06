#!/usr/bin/env bash
# Start (or stop) local dev services for the Resilient-Learn backend:
#   PostgreSQL 16  → 127.0.0.1:55432  (user rl, db resilient_learn, trust auth)
#   Redis          → 127.0.0.1:56379
#
# No docker daemon in this environment — we drive the system binaries
# directly. PostgreSQL refuses to run as root; when invoked as root this
# script re-executes the postgres commands via the `postgres` system user
# (runuser/setpriv), with the data dir chowned accordingly.
#
# Usage: dev-services.sh [start|stop|status]
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_ROOT="${RL_DEV_ROOT:-/tmp/claude-0/-home-user-lms/7fa6912a-7c0b-5754-ae62-3bf6c5a98f20/scratchpad}"
PGDATA="$DEV_ROOT/pgdata"
PGRUN="$DEV_ROOT/pgrun"            # log + unix sockets (writable by the pg user)
REDIS_DIR="$DEV_ROOT/redis"
PGBIN="/usr/lib/postgresql/16/bin"
PGPORT=55432
REDIS_PORT=56379
PGUSER=rl
PGDB=resilient_learn

CMD="${1:-start}"

# ---------------------------------------------------------------------------
# Root handling: postgres refuses to run as uid 0. Prefer the `postgres`
# system user via runuser; fall back to setpriv; otherwise (non-root) run
# directly. If nothing works we document the limitation and bail so callers
# can fall back to typecheck+build-only verification.
# ---------------------------------------------------------------------------
if [[ "$(id -u)" -eq 0 ]]; then
  if id postgres >/dev/null 2>&1 && command -v runuser >/dev/null 2>&1; then
    as_pg() { runuser -u postgres -- "$@"; }
    PG_OS_USER=postgres
  elif id postgres >/dev/null 2>&1 && command -v setpriv >/dev/null 2>&1; then
    as_pg() { setpriv --reuid=postgres --regid=postgres --clear-groups -- "$@"; }
    PG_OS_USER=postgres
  else
    echo "[dev-services] ERROR: running as root and no postgres system user /" >&2
    echo "runuser/setpriv available — PostgreSQL cannot start as uid 0." >&2
    echo "Fall back to typecheck+build-only verification." >&2
    exit 1
  fi
else
  as_pg() { "$@"; }
  PG_OS_USER="$(id -un)"
fi

pg_running() {
  as_pg "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1
}

start_postgres() {
  mkdir -p "$PGDATA" "$PGRUN"
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R "$PG_OS_USER" "$PGDATA" "$PGRUN"
    # The pg os-user must be able to traverse every ancestor of the data dir
    # (scratchpad ancestors are 700 root) — grant execute-only (no listing).
    local dir="$DEV_ROOT"
    while [[ "$dir" != "/" && -n "$dir" ]]; do
      chmod o+x "$dir" 2>/dev/null || true
      dir="$(dirname "$dir")"
    done
  fi

  if [[ ! -f "$PGDATA/PG_VERSION" ]]; then
    echo "[dev-services] initdb → $PGDATA (superuser: $PGUSER, auth: trust)"
    as_pg "$PGBIN/initdb" -D "$PGDATA" --username="$PGUSER" --auth=trust -E UTF8 >/dev/null
  fi

  if pg_running; then
    echo "[dev-services] postgres already running on :$PGPORT"
  else
    echo "[dev-services] starting postgres on 127.0.0.1:$PGPORT"
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGRUN/postgres.log" -w \
      -o "-p $PGPORT -c listen_addresses=127.0.0.1 -c unix_socket_directories='$PGRUN'" \
      start >/dev/null
  fi

  if ! "$PGBIN/psql" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='$PGDB'" | grep -q 1; then
    echo "[dev-services] creating database $PGDB"
    "$PGBIN/createdb" -h 127.0.0.1 -p "$PGPORT" -U "$PGUSER" "$PGDB"
  fi
}

start_redis() {
  mkdir -p "$REDIS_DIR"
  if redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    echo "[dev-services] redis already running on :$REDIS_PORT"
  else
    echo "[dev-services] starting redis on 127.0.0.1:$REDIS_PORT"
    redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --daemonize yes \
      --dir "$REDIS_DIR" --save "" --appendonly no \
      --logfile "$REDIS_DIR/redis.log"
    redis-cli -p "$REDIS_PORT" ping >/dev/null
  fi
}

case "$CMD" in
  start)
    "$BACKEND_DIR/scripts/gen-dev-keys.sh"
    start_postgres
    start_redis
    echo "[dev-services] ready:"
    echo "  DATABASE_URL=postgresql://$PGUSER@localhost:$PGPORT/$PGDB"
    echo "  REDIS_URL=redis://localhost:$REDIS_PORT"
    ;;
  stop)
    if pg_running; then
      as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null && \
        echo "[dev-services] postgres stopped"
    else
      echo "[dev-services] postgres not running"
    fi
    redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null && \
      echo "[dev-services] redis stopped" || echo "[dev-services] redis not running"
    ;;
  status)
    pg_running && echo "postgres: up (:$PGPORT)" || echo "postgres: down"
    redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && \
      echo "redis: up (:$REDIS_PORT)" || echo "redis: down"
    ;;
  *)
    echo "usage: $0 [start|stop|status]" >&2
    exit 2
    ;;
esac
