import "../helpers/env.js";
import assert from "node:assert/strict";
import http from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { io as connect } from "socket.io-client";
import { Server } from "socket.io";
import { createClient } from "redis";
import { after, before, beforeEach, describe, it } from "node:test";
import { claimJob, fireSlot, runOnce } from "../../src/cron/jobLock.js";
import { client, prisma, startServer } from "../helpers/app.js";
import { resetDb } from "../helpers/db.js";

let server, raw;
before(async () => {
  server = await startServer();
  raw = client(server.url);
});
after(() => server.close());
beforeEach(resetDb);

describe("run-once job lock across replicas (§27)", () => {
  it("only one of several concurrent replicas claims a scheduled run", async () => {
    const now = new Date("2026-11-13T10:30:05Z");
    const results = await Promise.all(Array.from({ length: 6 }, () => claimJob("push-campaigns", now)));
    assert.equal(results.filter(Boolean).length, 1);
  });

  it("runOnce executes the job exactly once, even when fired by several replicas at once", async () => {
    let runs = 0;
    const now = new Date("2026-11-13T10:30:41Z"); // same minute, different seconds
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        runOnce("daily", async () => { runs += 1; }, new Date(now.getTime() - i * 1000))
      )
    );
    assert.equal(runs, 1);
  });

  it("the next scheduled fire is claimable again; different jobs do not block each other", async () => {
    const a = new Date("2026-11-13T10:30:00Z");
    const b = new Date("2026-11-14T10:30:00Z");
    assert.equal(await claimJob("push-campaigns", a), true);
    assert.equal(await claimJob("push-campaigns", a), false);
    assert.equal(await claimJob("push-campaigns", b), true);
    assert.equal(await claimJob("maintenance-daily", a), true);
    assert.equal(fireSlot(a), "2026-11-13T10:30");
  });

  it("a failing job is logged, never thrown, and does not poison the next fire", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const first = await runOnce("boom", async () => { throw new Error("nope"); }, new Date("2026-11-13T11:00:00Z"));
      assert.equal(first, false);
      assert.equal(await runOnce("boom", async () => {}, new Date("2026-11-14T11:00:00Z")), true);
    } finally {
      console.error = original;
    }
  });

  it("lock rows expire so the daily purge removes them", async () => {
    await claimJob("x", new Date());
    const row = await prisma.idempotencyRecord.findFirst({ where: { key: { startsWith: "cron:x:" } } });
    assert.ok(row.expires_at > new Date(Date.now() + 24 * 3600e3));
  });
});

describe("liveness and readiness probes", () => {
  it("/health is up; /ready checks the database", async () => {
    const health = await fetch(`${server.url}/health`);
    assert.equal(health.status, 200);
    const ready = await fetch(`${server.url}/ready`);
    assert.equal(ready.status, 200);
    const body = await ready.json();
    assert.equal(body.data.checks.database, true);
    assert.equal(body.data.checks.redis, null); // Redis not configured in tests
  });
});

// These need a throwaway Redis:  TEST_REDIS_URL=redis://127.0.0.1:6390 npm test
const REDIS = process.env.TEST_REDIS_URL;
describe("Redis-backed scaling", { skip: REDIS ? false : "set TEST_REDIS_URL to run" }, () => {
  it("Socket.io events cross replicas through the adapter", async () => {
    const make = async () => {
      const pub = createClient({ url: REDIS });
      const sub = pub.duplicate();
      await Promise.all([pub.connect(), sub.connect()]);
      const srv = http.createServer();
      const io = new Server(srv);
      io.adapter(createAdapter(pub, sub));
      io.on("connection", (s) => s.join("room-1"));
      await new Promise((r) => srv.listen(0, "127.0.0.1", r));
      return { io, srv, pub, sub, url: `http://127.0.0.1:${srv.address().port}` };
    };
    const a = await make();
    const b = await make();
    const onB = connect(b.url, { transports: ["websocket"] });
    const got = [];
    onB.on("hello", (m) => got.push(m));
    await new Promise((r) => onB.on("connect", r));
    await new Promise((r) => setTimeout(r, 200));
    a.io.to("room-1").emit("hello", "from replica A"); // client is attached to replica B
    await new Promise((r) => setTimeout(r, 300));
    try {
      assert.deepEqual(got, ["from replica A"]);
    } finally {
      onB.close();
      for (const n of [a, b]) {
        await n.io.close();
        await Promise.all([n.pub.quit(), n.sub.quit()]);
      }
    }
  });
});
