#!/bin/bash
# Download the four Google font families as variable woff2 files for next/font/local.
set -e
cd /home/z/my-project
mkdir -p src/fonts
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

fetch_family () {
  local css_url="$1" subset="$2" out="$3"
  local css url
  css=$(curl -s --max-time 20 -A "$UA" "$css_url")
  # take the woff2 url from the @font-face block whose unicode-range matches the wanted subset comment
  url=$(echo "$css" | awk -v subset="/* $subset */" '
    index($0, subset) { inblock=1 }
    inblock && /src:.*url\(/ {
      match($0, /https:[^)]+\.woff2/)
      print substr($0, RSTART, RLENGTH)
      exit
    }
  ')
  if [ -z "$url" ]; then
    # fallback: first woff2 url in the css
    url=$(echo "$css" | grep -o 'https:[^)]*\.woff2' | head -1)
  fi
  echo "[$out] $url"
  curl -s --max-time 30 -A "$UA" -o "src/fonts/$out" "$url"
}

fetch_family "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@200..800&display=swap" "latin" "bricolage-var.woff2"
fetch_family "https://fonts.googleapis.com/css2?family=Public+Sans:wght@100..900&display=swap" "latin" "public-sans-var.woff2"
fetch_family "https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@100..900&display=swap" "devanagari" "noto-deva-var.woff2"
fetch_family "https://fonts.googleapis.com/css2?family=Noto+Sans+Tamil:wght@100..900&display=swap" "tamil" "noto-tamil-var.woff2"
ls -la src/fonts/
