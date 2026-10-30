#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
node --input-type=module -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<12))throw Error("Node.js >=22.12 is required; recommended 24.19.0")'
npm ci --no-audit --no-fund
npm run check
