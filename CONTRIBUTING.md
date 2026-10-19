# Contributing

Requirements: Node.js 22 or later.

```bash
npm install --ignore-scripts   # skips the optional @discordjs/opus native build (voice only)
npm test                       # node:test, fully mocked, no Discord connection
npm run build                  # tsc -> dist/
```

1. Open an issue first for anything larger than a small fix.
2. Branch from `main`, keep the change focused, and add or update tests under `test/`.
3. Make sure `npm test` and `npm run build` pass, then open a pull request.

Never commit a `.env` file or a real bot token. In stdio mode, write diagnostics to stderr only: anything on stdout breaks the MCP protocol.

Security issues: see [SECURITY.md](SECURITY.md).
