#!/bin/bash
echo "Checking recording status for cort_d..."
if  ! curl -sS --fail-with-body http://localhost:9997/v3/config/paths/get/cort_d | jq -e '.record == true' >/dev/null; then
  echo "Recording is not active for cort_d" >&2
  exit 1
fi
echo "Recording is active for cort_d"