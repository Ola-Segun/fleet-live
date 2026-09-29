# @fleet/web

The Fleet Live web app: Next.js 16 (App Router), MapLibre, and a Web Worker
running the fleet feed. See [../../DESIGN.md](../../DESIGN.md) and
[../../docs/LAYERS.md](../../docs/LAYERS.md).

- `pnpm --filter @fleet/web dev`: demo mode (simulator in the Worker) at http://localhost:3000
- `?mode=network`: connect to `pnpm --filter @fleet/sim-server start`
- `?n=20000`: stress size · `?trucks=off`: map without the truck layer, for measurement
