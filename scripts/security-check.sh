#!/usr/bin/env bash
# Report-only security sweep for the TownSquare host. Run as root (or via
# sudo); it reads nginx logs, the auth log, and the townsquare journal and
# prints a summary. It never blocks or changes anything.
#
# Usage: sudo scripts/security-check.sh [days]   (default: 1)
# No pipefail: grep exiting 1 on "no matches" is a normal, good outcome here.
set -u

DAYS="${1:-1}"
SINCE="$(date -d "-${DAYS} days" '+%Y-%m-%d %H:%M:%S')"
NGINX_LOGS=(/var/log/nginx/access.log /var/log/nginx/access.log.1)

# Paths whose 200 responses matter. SPA vhosts on this box answer every path
# with index.html, so a 200 alone is not a leak — compare body sizes below.
SENSITIVE='\.env|\.git/|wp-login|wp-admin|phpmyadmin|etc/passwd|\.php|cgi-bin|\.ssh|id_rsa|\.aws|docker-compose|\.sql'

section() { printf '\n=== %s ===\n' "$1"; }

section "Scanner probes (last 2 nginx log files), by status"
zcat -f "${NGINX_LOGS[@]}" 2>/dev/null | grep -iE "$SENSITIVE" \
  | awk '{print $9}' | sort | uniq -c | sort -rn

section "Sensitive paths that returned 2xx (verify these are SPA catch-alls)"
zcat -f "${NGINX_LOGS[@]}" 2>/dev/null | grep -iE "$SENSITIVE" \
  | awk '$9 ~ /^2/ {print $9, $10, $7}' | sort | uniq -c | sort -rn | head -15
echo "(distinct body sizes here = distinct pages; a new size is worth a manual curl)"

section "Top 10 IPs by request volume"
zcat -f "${NGINX_LOGS[@]}" 2>/dev/null | awk '{print $1}' | sort | uniq -c | sort -rn | head -10

section "TownSquare admin-auth failures (403 on /api/admin/login), by IP"
zcat -f "${NGINX_LOGS[@]}" 2>/dev/null | grep '/api/admin/login' \
  | awk '$9==403 {print $1}' | sort | uniq -c | sort -rn | head -10

section "TownSquare journal: non-routine events (last ${DAYS}d)"
journalctl -u townsquare.service --since "$SINCE" --no-pager 2>/dev/null \
  | grep -vE '"event":"(join|rename)"' \
  | grep -iE 'error|warn|fail|throttl|block_ip|reject|abuse' \
  | tail -30 || echo "none"

section "SSH: failed logins (last ${DAYS}d)"
journalctl -u ssh --since "$SINCE" --no-pager 2>/dev/null \
  | grep -cE 'Failed password|Invalid user' || echo 0

section "SSH: accepted logins from outside Tailscale (100.64/10) (last ${DAYS}d)"
journalctl -u ssh --since "$SINCE" --no-pager 2>/dev/null \
  | grep 'Accepted' | grep -vE 'from 100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.' || echo "none"

section "fail2ban currently banned"
if command -v fail2ban-client >/dev/null; then
  for jail in $(fail2ban-client status 2>/dev/null | grep 'Jail list' | sed 's/.*://;s/,//g'); do
    banned=$(fail2ban-client status "$jail" 2>/dev/null | grep 'Banned IP list' | sed 's/.*://')
    echo "$jail:${banned:- none}"
  done
else
  echo "fail2ban not installed"
fi

printf '\nDone. Report-only: nothing was blocked or modified.\n'
