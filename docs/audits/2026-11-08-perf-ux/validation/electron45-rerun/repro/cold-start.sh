#!/bin/zsh
# cold-start: launch app with vpr start, take first offscreen screenshot, compare to warm reference, quit.
# usage: REPO=/path/to/verynize-product ./cold-start.sh   (needs mcp-call.mjs next to it)
cd "$REPO"
MCP="$HOME/Library/Application Support/Verynize/mcp.json"
S="$(cd "$(dirname "$0")" && pwd)"
for i in 1 2 3; do
  old=$(python3 -c "import json;print(json.load(open('$MCP'))['pid'])")
  vpr start > $S/cold-$i.log 2>&1 &
  for t in $(seq 1 120); do sleep 1; p=$(python3 -c "import json;print(json.load(open('$MCP'))['pid'])" 2>/dev/null); [ "$p" != "$old" ] && break; done
  sleep 6
  (cd $S && mkdir -p cold && OUT=cold/$i-first.png node mcp-call.mjs take_screenshot '{"document":"spaces-research","id":"buv","scale":0.5}' | python3 -c "import json,sys;o=json.load(sys.stdin);print('run',$i,'first ms',o['ms'],o.get('isError'))")
  (cd $S && mkdir -p cold && OUT=cold/$i-second.png node mcp-call.mjs take_screenshot '{"document":"spaces-research","id":"buv","scale":0.5}' | python3 -c "import json,sys;o=json.load(sys.stdin);print('run',$i,'second ms',o['ms'],o.get('isError'))")
  agent-desktop close-app Electron >/dev/null 2>&1; sleep 4
done
