// Outbound WhatsApp (Meta Cloud API). Like push, it is best-effort: with no
// access token every send is a logged no-op that lands in a dev outbox, and a
// failed send never breaks the caller.

import { env } from "../../config/env.js";

export const LIMITS = Object.freeze({ buttons: 3, rows: 10, buttonTitle: 20, rowTitle: 24, rowDescription: 72, body: 1024, listButton: 20 });

const clip = (text, max) => {
  const value = String(text ?? "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

/**
 * Keeps a message inside WhatsApp's limits (3 buttons, 10 list rows, short
 * titles). The flow builds messages freely; this is the single guard.
 */
export function normalizeMessage(msg) {
  const body = clip(msg.body, LIMITS.body);
  if (msg.type === "buttons") {
    return {
      type: "buttons",
      body,
      buttons: msg.buttons.slice(0, LIMITS.buttons).map((b) => ({ id: b.id, title: clip(b.title, LIMITS.buttonTitle) })),
    };
  }
  if (msg.type === "list") {
    return {
      type: "list",
      body,
      button: clip(msg.button || "Choose", LIMITS.listButton),
      rows: msg.rows.slice(0, LIMITS.rows).map((r) => ({
        id: r.id,
        title: clip(r.title, LIMITS.rowTitle),
        ...(r.description ? { description: clip(r.description, LIMITS.rowDescription) } : {}),
      })),
    };
  }
  if (msg.type === "template") {
    return { type: "template", body, name: msg.name, language: msg.language, params: (msg.params ?? []).map(String) };
  }
  return { type: msg.type, body };
}

/** The Cloud API request body for one message. */
export function toGraphPayload(to, msg) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  if (msg.type === "buttons") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: msg.body },
        action: { buttons: msg.buttons.map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
      },
    };
  }
  if (msg.type === "list") {
    return {
      ...base,
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: msg.body },
        action: { button: msg.button, sections: [{ rows: msg.rows }] },
      },
    };
  }
  if (msg.type === "location_request") {
    return {
      ...base,
      type: "interactive",
      interactive: { type: "location_request_message", body: { text: msg.body }, action: { name: "send_location" } },
    };
  }
  if (msg.type === "template") {
    return {
      ...base,
      type: "template",
      template: {
        name: msg.name,
        language: { code: msg.language },
        components: [{ type: "body", parameters: msg.params.map((value) => ({ type: "text", text: value })) }],
      },
    };
  }
  return { ...base, type: "text", text: { body: msg.body, preview_url: true } };
}

let testClient; // undefined = real/dev behaviour
const outbox = []; // dev and test only: what the bot "sent"

/** Test seam: `fn(to, message)` receives every outgoing message; pass undefined to reset. */
export function setWhatsappClientForTests(fn) {
  testClient = fn;
}

/** Dev/test: take (and clear) the messages sent to one number. */
export function drainOutbox(to) {
  const mine = outbox.filter((m) => m.to === to);
  for (const m of mine) outbox.splice(outbox.indexOf(m), 1);
  return mine.map((m) => m.message);
}

/** Sends one message to a WhatsApp id (digits with country code, e.g. 919847000001). */
export async function sendWhatsapp(franchise, to, rawMessage) {
  const message = normalizeMessage(rawMessage);
  try {
    if (testClient) {
      await testClient(to, message);
      return true;
    }
    if (!env.whatsapp.accessToken || !franchise.whatsapp_phone_number_id) {
      if (!env.isProduction) {
        outbox.push({ to, message });
        if (outbox.length > 200) outbox.shift();
      }
      console.log(`[whatsapp] dev mode, not sent to ${to}: ${message.body.replace(/\n/g, " ").slice(0, 80)}`);
      return false;
    }
    const url = `https://graph.facebook.com/${env.whatsapp.apiVersion}/${franchise.whatsapp_phone_number_id}/messages`;
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.whatsapp.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(toGraphPayload(to, message)),
    });
    if (!response.ok) {
      console.error(`[whatsapp] send failed ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[whatsapp] send error:", error.message);
    return false;
  }
}

/** Downloads a media file (a voice note) the customer sent. Returns { buffer, mimetype } or null. */
export async function downloadWhatsappMedia(media_id) {
  if (!env.whatsapp.accessToken || !media_id) return null;
  try {
    const headers = { authorization: `Bearer ${env.whatsapp.accessToken}` };
    const meta = await (await fetch(`https://graph.facebook.com/${env.whatsapp.apiVersion}/${media_id}`, { headers })).json();
    if (!meta.url) return null;
    const file = await fetch(meta.url, { headers });
    if (!file.ok) return null;
    return { buffer: Buffer.from(await file.arrayBuffer()), mimetype: meta.mime_type || "audio/ogg" };
  } catch (error) {
    console.error("[whatsapp] media download failed:", error.message);
    return null;
  }
}
