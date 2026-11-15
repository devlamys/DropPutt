// Play a WhatsApp customer in the terminal, without WhatsApp or a Meta account.
//
//   node scripts/whatsapp-sim.mjs [phone] [--url http://localhost:3000] [--slug kizhissery]
//
// Type text to chat. When the bot shows buttons or a list, type its number to
// tap it. "loc 11.20,76.05" shares a location. Status updates the bot sends
// later (rider accepted, delivered...) are printed as they arrive. "quit" exits.

import readline from "node:readline";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = flag("url", "http://localhost:3000").replace(/\/$/, "");
const slug = flag("slug", "kizhissery");
const from = (args.find((a) => /^\d{10,13}$/.test(a)) ?? "919847000001").replace(/^(\d{10})$/, "91$1");

let options = []; // what the last bot message offered: [{ id, kind, title }]

async function call(path, init) {
  const res = await fetch(`${base}/api/v1/whatsapp${path}`, {
    ...init,
    headers: { "content-type": "application/json" },
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? "request failed");
  return json.data;
}

function show(message) {
  console.log(`\n🤖 ${message.body.replace(/\n/g, "\n   ")}`);
  if (message.type === "buttons") {
    options = message.buttons.map((b) => ({ id: b.id, kind: "button", title: b.title }));
  } else if (message.type === "list") {
    options = message.rows.map((r) => ({ id: r.id, kind: "list", title: r.title }));
    message.rows.forEach((r, i) => console.log(`   ${i + 1}. ${r.title}${r.description ? ` — ${r.description}` : ""}`));
    return;
  } else if (message.type === "location_request") {
    console.log('   [Send location button] type: loc 11.20,76.05');
    return;
  }
  options.forEach((o, i) => console.log(`   [${i + 1}] ${o.title}`));
}

async function say(payload) {
  options = [];
  const { replies } = await call("/dev/simulate", {
    method: "POST",
    body: JSON.stringify({ from, franchise_slug: slug, ...payload }),
  });
  for (const reply of replies) show(reply);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "\n👤 > " });
console.log(`WhatsApp simulator · customer ${from} · ${base} · franchise ${slug}\nType "hi" to start.`);
rl.prompt();

setInterval(async () => {
  try {
    const { messages } = await call(`/dev/outbox?to=${from}`);
    for (const m of messages) show(m);
    if (messages.length) rl.prompt(true);
  } catch {
    /* server restarting */
  }
}, 3000).unref();

rl.on("line", async (line) => {
  const input = line.trim();
  try {
    if (input === "quit" || input === "exit") process.exit(0);
    const loc = /^loc\s+(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/i.exec(input);
    if (loc) await say({ location: { lat: Number(loc[1]), lng: Number(loc[3]) } });
    else if (/^\d+$/.test(input) && options[Number(input) - 1]) {
      const choice = options[Number(input) - 1];
      await say(choice.kind === "button" ? { button_id: choice.id } : { list_id: choice.id });
    } else if (input) await say({ text: input });
  } catch (error) {
    console.log(`⚠️  ${error.message}`);
  }
  rl.prompt();
});
