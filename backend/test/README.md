# Backend tests

```bash
npm test            # prepares the test database, then runs everything (~45 s)
npm run test:unit   # pure money / time logic only, no database (~0.2 s)
```

* Uses Node's built-in runner (`node:test`) — no test framework to install.
* Runs against its own database, **`dropputt_test`**, created on first run
  next to your dev database. Every test file empties all its tables, so the
  helper refuses to start unless the database name ends in `_test`.
* Each integration test starts the real app (HTTP + Socket.io) on a random
  port and talks to it over the network, exactly like a client.
* Files run one at a time (`--test-concurrency=1`) because they share a database.

| File | Covers (SPEC) |
|---|---|
| `unit/money.test.js` | §8–§16 rounding, split, promo, tip, rain, cash, vendor payable |
| `unit/time-and-slots.test.js` | §26 / §40 IST window and product slots |
| `integration/tenancy.test.js` | §42 tenant uniqueness and isolation |
| `integration/auth.test.js` | §58 tokens, rotation, reuse, logout; §47 envelope |
| `integration/orders.test.js` | §17 race, §20 tip, §23–§25 settlement, retry, milestone |
| `integration/marketplace.test.js` | §7 cart rules, checkout, §40 feed |
| `integration/gps.test.js` | §21 GPS accuracy, §37.4 uploads |
| `integration/mobile.test.js` | §49 devices, §51 push, §50 offline GPS, §48 pagination, §54 version gate |
| `integration/reconciliation.test.js` | §41 reconciliation, earnings, vendor ledger |
| `integration/security.test.js` | §37 sockets, leaks, input handling, role guards, HTTPS |

Push is tested with a fake messaging client, so no Firebase account is needed.
