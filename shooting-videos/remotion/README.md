# Remotion project

Sync from `aws/shooting-remotion/` excluding `node_modules/` and `out/`:

```bash
../../scripts/sync_from_workspace.sh /path/to/aws
cd shooting-videos/remotion && npm ci
```

Add to root `package.json` scripts after sync:

- `render:template-a` — hero telestration cuts
- `render:library-swatch` — annotation primitive preview (optional)
