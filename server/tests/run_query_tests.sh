#!/bin/bash
# Multi-turn follow-up test runner for QUERY_TEST.md Section 14
# Sends SSE chat requests and captures the response text + timing

COOKIE_FILE="/tmp/tmcai_cookies.txt"
BASE="http://localhost:4002/api/chat/stream"
RESULTS_FILE="/tmp/query_test_results.txt"

> "$RESULTS_FILE"

send_query() {
  local label="$1"
  local message="$2"
  local conv_id="$3"
  local provider="gemini-flash"

  local body
  if [ -n "$conv_id" ]; then
    body="{\"message\":\"$message\",\"provider\":\"$provider\",\"conversationId\":$conv_id}"
  else
    body="{\"message\":\"$message\",\"provider\":\"$provider\"}"
  fi

  echo "───────────────────────────────────────" >> "$RESULTS_FILE"
  echo "[$label] Query: $message" >> "$RESULTS_FILE"
  echo "  ConversationId: ${conv_id:-new}" >> "$RESULTS_FILE"

  local start_ms=$(($(date +%s%N)/1000000))

  # Capture full SSE response
  local response
  response=$(curl -s -b "$COOKIE_FILE" -X POST "$BASE" \
    -H "Content-Type: application/json" \
    -d "$body" \
    --max-time 30 2>&1)

  local end_ms=$(($(date +%s%N)/1000000))
  local elapsed=$(( end_ms - start_ms ))

  # Extract conversationId from meta
  local new_conv_id
  new_conv_id=$(echo "$response" | grep -o '"conversationId":[0-9]*' | head -1 | grep -o '[0-9]*')

  # Extract text chunks
  local text
  text=$(echo "$response" | grep 'data: ' | sed 's/^data: //' | \
    python3 -c "
import sys, json
chunks = []
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try:
        d = json.loads(line)
        if d.get('type') == 'chunk':
            chunks.append(d.get('content',''))
        elif d.get('type') == 'meta':
            print(f'  Intent: {d.get(\"intent\",\"?\")}, Elapsed: {d.get(\"elapsed\",\"?\")}ms, Tokens: {d.get(\"inputTokens\",\"?\")}in/{d.get(\"outputTokens\",\"?\")}out')
    except: pass
print('  Response (first 300 chars): ' + ''.join(chunks)[:300])
" 2>&1)

  echo "  Wall time: ${elapsed}ms" >> "$RESULTS_FILE"
  echo "$text" >> "$RESULTS_FILE"

  # Return conversation ID for follow-ups
  echo "$new_conv_id"
}

echo "=== TMC AI Multi-Turn Test — $(date) ===" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

# ── S1: Employee Follow-Up ──────────────────────────────────
echo "▶ S1: Employee Follow-Up" >> "$RESULTS_FILE"
conv=$(send_query "S1a" "provide me info about employees" "")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S1b" "provide me key statistics" "$conv")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S1c" "show department breakdown" "$conv")
echo "" >> "$RESULTS_FILE"

# ── S2: Project Follow-Up ──────────────────────────────────
echo "▶ S2: Project Follow-Up" >> "$RESULTS_FILE"
conv=$(send_query "S2a" "show me all active projects" "")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S2b" "which ones have critical risks?" "$conv")
echo "" >> "$RESULTS_FILE"

# ── S3: Sales Follow-Up ────────────────────────────────────
echo "▶ S3: Sales Follow-Up" >> "$RESULTS_FILE"
conv=$(send_query "S3a" "show me sales revenue breakdown" "")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S3b" "compare this year vs last year" "$conv")
echo "" >> "$RESULTS_FILE"

# ── S4: Domain Switch ──────────────────────────────────────
echo "▶ S4: Domain Switch" >> "$RESULTS_FILE"
conv=$(send_query "S4a" "how many employees do we have?" "")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S4b" "and how many active projects?" "$conv")
echo "" >> "$RESULTS_FILE"

# ── S5: Vague Follow-Up ────────────────────────────────────
echo "▶ S5: Vague Follow-Up" >> "$RESULTS_FILE"
conv=$(send_query "S5a" "tell me about the delivery department" "")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S5b" "who leads it?" "$conv")
echo "" >> "$RESULTS_FILE"

# ── S6: Employee Statistics Depth ──────────────────────────
echo "▶ S6: Employee Statistics Depth" >> "$RESULTS_FILE"
conv=$(send_query "S6a" "provide employee details" "")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S6b" "show me grade distribution" "$conv")
echo "" >> "$RESULTS_FILE"

# ── S9: Count Then Detail ──────────────────────────────────
echo "▶ S9: Count Then Detail" >> "$RESULTS_FILE"
conv=$(send_query "S9a" "how many projects are behind schedule?" "")
echo "  [conv=$conv]" >> "$RESULTS_FILE"
conv=$(send_query "S9b" "list them" "$conv")
echo "" >> "$RESULTS_FILE"

echo "=== TESTS COMPLETE ===" >> "$RESULTS_FILE"
cat "$RESULTS_FILE"
