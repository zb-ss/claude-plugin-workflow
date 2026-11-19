#!/usr/bin/env bash
# contact-sheet.sh <video> <out.png> <cols> <t1> [t2 ...]
# Grabs a frame at each time (seconds) and tiles them cols-wide into one PNG, so a whole
# take can be checked in a few image reads. 2 columns = 960x540 tiles, 3 = 640x360.
# Use the .srt cue times to pick the moments that must land (results, errors, toasts).
set -euo pipefail
video=$1; out=$2; cols=$3; shift 3
case "$cols" in 2) w=960; h=540 ;; 3) w=640; h=360 ;; *) echo "cols must be 2 or 3" >&2; exit 1 ;; esac
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
n=0
for t in "$@"; do
	ffmpeg -y -loglevel error -ss "$t" -i "$video" -vframes 1 -vf "scale=$w:$h" "$tmp/$n.png"
	n=$((n + 1))
done
while [ $((n % cols)) -ne 0 ]; do
	ffmpeg -y -loglevel error -f lavfi -i "color=black:s=${w}x${h}" -vframes 1 "$tmp/$n.png"
	n=$((n + 1))
done
inputs=(); for ((i = 0; i < n; i++)); do inputs+=(-i "$tmp/$i.png"); done
rows=$((n / cols)); filter=''; stack=''
for ((r = 0; r < rows; r++)); do
	row=''; for ((c = 0; c < cols; c++)); do row+="[$((r * cols + c))]"; done
	filter+="${row}hstack=$cols[r$r];"; stack+="[r$r]"
done
if [ "$rows" -gt 1 ]; then filter+="${stack}vstack=$rows"; else filter=${filter%"[r0];"}; fi
ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filter" "$out"
echo "$out"
