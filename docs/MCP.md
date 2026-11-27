# Claude in Constructa (MCP server)

Constructa ships an [MCP](https://modelcontextprotocol.io) server, so Claude (Claude Desktop, Claude Code, or any MCP client) can build in the editor you have open: read the scene, add parts, wire pins, write and run sketches, read Serial and look at the 3D view.

```
Claude ──MCP (stdio)──▶ tools/mcp/constructa-mcp.mjs ──ws://127.0.0.1:7341──▶ Constructa tab
                                                                          └▶ src/mcp/tools.js
```

Claude starts the server. The editor tab connects to it, because a web page cannot accept connections, only make them. Each tool call runs in the tab through the same store actions as the UI. Every edit is one undo step (Ctrl+Z) and autosaves like any other change.

## 1. Connect Claude to the server

**Claude Code** — nothing to do inside this repo: [`.mcp.json`](../.mcp.json) registers `constructa`. Start `claude` in the repo, accept the project MCP prompt, and check with `/mcp`.

**Claude Desktop** — Settings → Developer → Edit Config (`%APPDATA%\Claude\claude_desktop_config.json` on Windows, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS), add, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "constructa": {
      "command": "node",
      "args": ["C:\\Users\\kannan\\Desktop\\VS CODE\\Imaginarium\\tools\\mcp\\constructa-mcp.mjs"]
    }
  }
}
```

Use the absolute path of your checkout. Node 18 or newer is needed, and `npm install` must have run (the server uses `@modelcontextprotocol/sdk`, `ws` and `zod`).

## 2. Connect the editor to the server

Open Constructa once with `?mcp` in the address:

- dev: `http://localhost:5173/Imaginarium/?mcp`
- live site: `https://constructa.atumx.in/?mcp`
- different port: `?mcp=7350` (and start the server with `CONSTRUCTA_MCP_PORT=7350`)

The setting is remembered in that browser, so later visits connect without the `?mcp`. To turn it off, open the editor once with `?mcp=0`. The status bar shows **Claude connected** while the tab is linked. If Claude isn't running yet, it shows "waiting for the MCP server" and keeps retrying quietly.

Only one tab is linked at a time. A newly opened tab takes over and the older one shows "connected in another tab".

## Tools

| Tool | What it does |
|---|---|
| `constructa_status` | Whether an editor is linked, and its URL |
| `get_scene` | Parts (id, name, type, position cm, rotation °, pins), wires, target board, run state |
| `list_parts` | Catalog for `add_part`: electronics (type, variant, description, pins) and CAD shapes |
| `add_part` | Add a part by type (and variant, name, position, rotation). Loads the real model and pins |
| `update_part` | Move / rotate / rename / recolour / set physics weight (`mass_kg`, for hollow printed parts). Only plain shapes can be scaled; detach an attached part before moving it |
| `attach_part` | Fix a part onto a servo horn / motor shaft where it is, so it turns with that joint (chains allowed: knee servo on the hip horn, shin on the knee horn) |
| `detach_part` | Free an attached part, leaving it in place |
| `delete_part` | Remove a part and its wires |
| `get_pins` | A part's pins with their role (power/gnd/signal) and what each is wired to |
| `connect` / `disconnect` | Wire `"Arduino_1:D9"` → `"Servo_1:SIGNAL"`. Unwire by id or by end pin |
| `get_code` / `set_code` | Read / replace the sketch. `set_code` also returns a compile check |
| `check_code` | The Run-button compile check: errors with line/column + "did you mean", warnings |
| `run_code` | Compile + run (optionally with new code), wait, return Serial. Enters the simulator for robots with actuators |
| `stop_code` / `get_serial` | Stop the sketch / read the Serial monitor (also shown in the Code panel) |
| `screenshot` | JPEG of the 3D viewport, optionally from a named view (home/top/front/…) |
| `undo` / `redo` | Same as Ctrl+Z / Ctrl+Y |

Units: 1 scene unit = 1 cm, +y up, rotations in degrees. Parts are referred to by name or id.

Try asking Claude: *"Add an Arduino and an SG90 servo, wire the servo to pin 9, and write a sketch that sweeps it 0→180 and prints the angle. Run it and show me a screenshot."*

## Security

- The bridge listens on **127.0.0.1 only**. It is never reachable from the network.
- It accepts connections only from Constructa pages: `localhost` / `127.0.0.1` at any port, `https://constructa.atumx.in`, and the Electron shell. Other websites open in the same browser can't attach and receive Claude's calls. Add more origins with `CONSTRUCTA_MCP_ORIGINS=https://example.com`.
- The bridge is **off** in every browser until you open the editor with `?mcp`. Nothing is loaded for users who don't.
- Claude can only use the tools above. It has no file system access or arbitrary code execution in the page. Sketches run in the simulator's existing sandbox.

## Testing

```bash
npm run dev          # in one terminal
npm run test:mcp     # tools/mcp/selftest.mjs — starts the server like Claude does, opens the editor
                     # headless with ?mcp, and drives every tool (25 checks)
```

The self-test uses port 7349, so it doesn't collide with a Claude session on 7341.

## Troubleshooting

- **"Constructa is not connected"**: open the editor with `?mcp`, and check that the status bar says *Claude connected*.
- **"Port 7341 is already in use"**: two servers are running, e.g. Claude Desktop *and* Claude Code. Close one, or give one a different `CONSTRUCTA_MCP_PORT` and open the editor with `?mcp=<port>`.
- **Status bar stuck on "waiting for the MCP server"**: Claude isn't running, or its server failed to start. In Claude Code run `/mcp`. In Claude Desktop see Settings → Developer → logs.
- **The Electron app**: the server already accepts its `file://` origin, but the desktop app has no address bar for `?mcp`, so there is no switch to turn the bridge on there yet. Use the browser editor for now.
