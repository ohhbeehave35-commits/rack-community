#!/bin/bash
# Admission control. A job is admitted only if
#   max(live memory in use, declared total) + candidate peak <= LIMIT
# where declared total = BASE + the declared peaks of admitted jobs whose pid is still alive.
# One flock around check-and-record. A job's entry (ADMITTED.d/<pid>) is dropped only when that pid is gone.
#
#   admit.sh --run <job> [peak] -- <cmd...>   check; on ADMIT record under this pid and exec the command
#                                             (the entry dies with it); on WAIT exit 75
#   admit.sh <job> [peak]                     check only (nothing recorded); exit 0 admit, 1 wait
#   admit.sh --dry                            table of every job listed in peaks.conf
#
# Settings (environment):  RACK_DIR  folder holding peaks.conf, ADMITTED.d and the ledger (default: this script's folder)
#                          ADMIT_LIMIT  memory ceiling in GB (default 90)   ADMIT_BASE  GB the host itself uses (default 10)
#                          ADMIT_PREVIEW=1  check-only calls write to ADMISSIONS-PREVIEW.md, never the real ledger
#                          ADMIT_USED_GB  use this number instead of reading `free` (for tests)
# peaks.conf: one job per line, "<name> <peak GB>"; lines starting with # are ignored.
cd "${RACK_DIR:-$(dirname "$0")}" || exit 2
LIMIT=${ADMIT_LIMIT:-90}; BASE=${ADMIT_BASE:-10}
declare -A PEAK=()
if [ -f peaks.conf ]; then
  while read -r name gb _; do
    case "$name" in ''|'#'*) continue;; esac
    [[ "$gb" =~ ^[0-9]+$ ]] && PEAK[$name]=$gb
  done < peaks.conf
fi
mkdir -p ADMITTED.d
LED=ADMISSIONS.md
line() {
  if [ "${ADMIT_PREVIEW:-0}" = 1 ]; then echo "PREVIEW $*" >> ADMISSIONS-PREVIEW.md; else echo "$*" | tee -a "$LED" >/dev/null; fi
}
used_gb() { if [ -n "${ADMIT_USED_GB:-}" ]; then echo "$ADMIT_USED_GB"; else free -g | awk 'NR==2{print $3}'; fi; }
declared() {
  local t=$BASE who="base $BASE" f p j k
  for f in ADMITTED.d/*; do
    [ -f "$f" ] || continue
    p=$(basename "$f")
    if kill -0 "$p" 2>/dev/null; then read -r j k < "$f"; t=$((t+k)); who="$who + $j $k (pid $p)"; else rm -f "$f"; fi
  done
  echo "$t|$who"
}
check() {  # $1 job  $2 peak  -> sets VERDICT, returns 0 (admit) or 1 (wait)
  local used d dt dw eff
  used=$(used_gb); d=$(declared); dt=${d%%|*}; dw=${d#*|}
  eff=$used; [ "$dt" -gt "$eff" ] && eff=$dt
  if [ $((eff+$2)) -le "$LIMIT" ]; then
    VERDICT="ADMIT $1 peak $2: max(live $used, declared $dt [$dw]) + $2 = $((eff+$2)) <= $LIMIT"; return 0
  else
    VERDICT="WAIT  $1 peak $2: max(live $used, declared $dt [$dw]) + $2 = $((eff+$2)) > $LIMIT"; return 1
  fi
}
if [ "$1" = --dry ]; then
  d=$(declared)
  printf "%s dry run: live %s GB, declared %s [%s], limit %s\n| job | peak | effective+peak | verdict |\n|---|---|---|---|\n" \
    "$(date "+%m-%d %H:%M:%S")" "$(used_gb)" "${d%%|*}" "${d#*|}" "$LIMIT"
  for j in "${!PEAK[@]}"; do
    check "$j" "${PEAK[$j]}"; v=${VERDICT%%:*}
    printf "| %s | %s | %s | %s |\n" "$j" "${PEAK[$j]}" "$(echo "$VERDICT" | grep -o '= [0-9]*' | head -1 | cut -c3-)" "${v%% *}"
  done
  exit 0
fi
RUN=0; [ "$1" = --run ] && { RUN=1; shift; }
job=$1; shift
peak=${PEAK[$job]:-}
if [ -n "$1" ] && [ "$1" != "--" ]; then peak=$1; shift; fi
[ "$1" = "--" ] && shift
[[ "$peak" =~ ^[0-9]+$ ]] || { echo "admit: unknown job $job and no numeric peak given"; exit 2; }
exec 9>admit.lock; flock -w 30 9 || { echo "admit: lock timeout"; exit 75; }
if check "$job" "$peak"; then
  line "$(date "+%m-%d %H:%M:%S") $VERDICT$( [ $RUN = 1 ] && echo " (pid $$)" )"
  if [ $RUN = 1 ]; then echo "$job $peak" > ADMITTED.d/$$; flock -u 9; exec "$@"; fi
  exit 0
else
  line "$(date "+%m-%d %H:%M:%S") $VERDICT"
  [ $RUN = 1 ] && exit 75 || exit 1
fi
