// Webhook payload parsing and exactly-once, in-order processing of customer messages.

import { prisma } from "../../config/prisma.js";
import { handleInbound } from "./flow.js";
import { sendWhatsapp } from "./client.js";
import { M } from "./messages.js";

/** Meta's webhook body -> [{ phone_number_id, wamid, from, name, message }]. */
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phone_number_id = value.metadata?.phone_number_id;
      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of value.messages ?? []) {
        let message = { type: "other" };
        if (m.type === "text") message = { type: "text", text: m.text?.body ?? "" };
        else if (m.type === "interactive") {
          const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
          message = reply ? { type: m.interactive.button_reply ? "button" : "list", id: reply.id, text: reply.title } : message;
        } else if (m.type === "location" && m.location) {
          message = { type: "location", location: { lat: Number(m.location.latitude), lng: Number(m.location.longitude) } };
        } else if (m.type === "audio") message = { type: "audio", media_id: m.audio?.id };
        out.push({ phone_number_id, wamid: m.id, from: m.from, name: names.get(m.from), message });
      }
    }
  }
  return out;
}

// One message at a time per customer, so two quick taps cannot race on the session.
const chains = new Map();
function inOrder(key, job) {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.then(job, job).finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  chains.set(key, next);
  return next;
}

// Flood guard: at most 30 messages a minute per customer.
const buckets = new Map();
function tooChatty(key, now = Date.now()) {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  buckets.set(key, recent);
  return recent.length > 30;
}

/** Handles one parsed inbound message and sends the replies. Never throws. */
export function processInbound(franchise, inbound) {
  return inOrder(`${franchise.id}:${inbound.from}`, async () => {
    try {
      if (tooChatty(`${franchise.id}:${inbound.from}`)) return;
      if (inbound.wamid) {
        try {
          await prisma.whatsappInbound.create({ data: { wamid: inbound.wamid } });
        } catch (error) {
          if (error?.code === "P2002") return; // Meta retried: already handled
          throw error;
        }
      }
      const replies = await handleInbound({
        franchise,
        wa_id: inbound.from,
        name: inbound.name,
        message: inbound.message,
      });
      for (const reply of replies) await sendWhatsapp(franchise, inbound.from, reply);
    } catch (error) {
      console.error("[whatsapp] inbound failed:", error);
      await sendWhatsapp(franchise, inbound.from, M.failed("something went wrong, please try again")).catch(() => {});
    }
  });
}
