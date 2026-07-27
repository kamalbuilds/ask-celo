#!/usr/bin/env bash
# fresh-clone.sh — follow the README as a stranger would.
#
#   npm run fresh
#
# Every claim in the README was verified individually and the setup block was
# still broken: an inline comment mid-continuation silently truncated the
# command, and the placeholder env produced a viem stack trace instead of
# naming the variable to fill in. Both were invisible from inside the project,
# where the environment is already correct.
#
# This clones the public repo into a temp dir and runs the documented path.
set -euo pipefail

REPO="${REPO:-https://github.com/kamalbuilds/ask-celo}"
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT

echo "=== clone"
git clone -q --depth 1 "$REPO" "$DIR"
cd "$DIR"

echo "=== the README's shell blocks parse"
# Extract every bash block and syntax-check it. The comment-in-continuation bug
# would not be caught by reading; bash catches it in a second.
python3 - <<'PY' > "$DIR/.blocks"
import re, pathlib
md = pathlib.Path("README.md").read_text()
for block in re.findall(r"```bash\n(.*?)```", md, re.S):
    print(block)
    print("### END")
PY
n=0
buf=""
while IFS= read -r line; do
  if [ "$line" = "### END" ]; then
    n=$((n+1))
    printf '%s' "$buf" > "$DIR/.blk"
    bash -n "$DIR/.blk" || { echo "  ! block $n has a syntax error"; exit 1; }
    # A line ending in a comment, immediately after one ending in a backslash,
    # is valid bash and silently truncates the command. That is the exact bug
    # that shipped: everything after it never ran. bash -n cannot see it.
    if awk '/\\$/ { prev=1; next } prev && /#/ { found=1 } { prev=0 } END { exit !found }' "$DIR/.blk"; then
      echo "  ! block $n: a comment follows a line continuation, truncating the command"
      exit 1
    fi
    buf=""
  else
    buf="$buf$line"$'\n'
  fi
done < "$DIR/.blocks"
echo "  $n block(s) parse"

echo "=== npm install"
npm install --silent >/dev/null 2>&1
echo "  ok"

echo "=== the documented env file exists"
[ -f .env.example ] || { echo "  ! README says to copy .env.example and it is missing"; exit 1; }
cp .env.example .env.local
echo "  ok"

echo "=== an unfilled env fails by naming the variable"
# The failure a new reader actually hits. It must name what to fill in, not
# surface a library error from three layers down.
set +e
out=$(set -a; . ./.env.local; set +a; npx tsx src/seller.ts 2>&1 | head -12)
set -e
if echo "$out" | grep -qE 'SELLER_PAY_TO|X402_API_KEY'; then
  echo "  ok — $(echo "$out" | grep -oE '(SELLER_PAY_TO|X402_API_KEY)[^.]*\.' | head -1)"
else
  echo "  ! the error does not name the missing variable:"
  echo "$out" | sed 's/^/    /'
  exit 1
fi

echo "=== the live service the README points at is up"
curl -sf --max-time 20 https://ask-celo.vercel.app/api/health >/dev/null \
  && echo "  ok" || { echo "  ! the documented URL is not responding"; exit 1; }

echo
echo "a stranger can follow the README"
