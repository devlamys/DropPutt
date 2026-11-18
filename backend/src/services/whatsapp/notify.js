// Status updates to customers who ordered on WhatsApp. Best-effort and silent
// for web orders: it never throws, so it can be called after any commit.
// Inside WhatsApp's 24-hour customer-service window these are free-form
// messages, so no approved templates are needed.

import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { emitTo, rooms } from "../../socket/socketHandler.js";
import { sendWhatsapp } from "./client.js";
import { rupees, statusLine, text } from "./messages.js";

export const waIdOf = (customer_phone) => `91${customer_phone}`;

const trackUrl = (token) => `${env.publicAppUrl}/drop/${token}`;

/**
 * @param event "accepted" | "picked_up" | "delivered" | "cancelled"
 * @param extra { by?: role } — a customer's own cancel is already answered in the chat.
 */
export async function notifyWhatsappOrder(orderId, event, extra = {}) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        franchise: true,
        rider: { select: { vehicle_type: true, user: { select: { name: true } } } },
      },
    });
    if (!order || order.channel !== "WHATSAPP" || !order.customer_phone) return;
    if (!order.franchise.whatsapp_enabled && env.isProduction) return;

    const link = trackUrl(order.location_token);
    let body;
    if (event === "accepted") {
      const rider = order.rider?.user?.name?.trim().split(/\s+/)[0];
      body = `#${order.order_number}\n${statusLine("RIDER_ASSIGNED")}${rider ? `\n🛵 ${rider}` : ""}\n${link}`;
    } else if (event === "picked_up") {
      body = `#${order.order_number}\n${statusLine("PICKED_UP")}\n${link}`;
    } else if (event === "delivered") {
      body = `#${order.order_number}\n${statusLine("DELIVERED")}${Number(order.grand_total) > 0 ? `\n${rupees(order.grand_total)}` : ""}`;
    } else if (event === "cancelled") {
      if (extra.by === "CUSTOMER") return;
      body = `#${order.order_number}\n${statusLine("CANCELLED")}${order.cancel_reason ? `\n${order.cancel_reason}` : ""}`;
    } else {
      return;
    }
    const sent = await sendWhatsapp(order.franchise, waIdOf(order.customer_phone), text(body));
    // These two messages carry the tracking link, so the rider need not send it.
    if (sent && (event === "accepted" || event === "picked_up")) await markMagicLinkSent(order);
  } catch (error) {
    console.error("[whatsapp] notify failed:", error.message);
  }
}

async function markMagicLinkSent(order) {
  const claimed = await prisma.order.updateMany({
    where: { id: order.id, magic_link_sent_at: null },
    data: { magic_link_sent_at: new Date() },
  });
  if (claimed.count && order.rider_id) {
    emitTo(rooms.rider(order.rider_id), "magic_link_sent", { order_id: order.id });
  }
}

/**
 * Sends the Magic Link to the customer from the franchise's business WhatsApp
 * number (SPEC §60.6). Called when a rider accepts and again at pickup (a Call
 * Rider Now order learns the phone only then); sends once per order. Best-effort:
 * when it cannot send, magic_link_sent_at stays null and the rider's own
 * "Send WhatsApp Magic Link" button remains the fallback.
 * Orders placed on WhatsApp already get the link in the "accepted" message.
 */
export async function sendMagicLink(orderId) {
  let claimed = false;
  try {
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { franchise: true } });
    if (!order || order.magic_link_sent_at || !order.customer_phone || order.channel === "WHATSAPP") return false;
    if (!["RIDER_ASSIGNED", "PICKED_UP"].includes(order.order_status)) return false;
    const { franchise } = order;
    if (!franchise.whatsapp_enabled || !franchise.whatsapp_phone_number_id) return false;

    // Claim first so a concurrent accept/pickup cannot send it twice.
    const claim = await prisma.order.updateMany({
      where: { id: order.id, magic_link_sent_at: null },
      data: { magic_link_sent_at: new Date() },
    });
    if (!claim.count) return false;
    claimed = true;

    const link = trackUrl(order.location_token);
    const { magicLinkTemplate: name, magicLinkTemplateLang: language } = env.whatsapp;
    const message = name
      ? { type: "template", name, language, params: [order.order_number, link], body: `#${order.order_number} ${link}` }
      : text(
          `നമസ്കാരം! നിങ്ങളുടെ ഓർഡർ #${order.order_number} വരുന്നുണ്ട്. ` +
            `കൃത്യമായ ലൊക്കേഷൻ പങ്കിടാൻ ഈ ലിങ്ക് തുറക്കുക:\n${link}\n\n` +
            `Your order is on the way. Open this link to share your location and track the rider.`
        );
    const sent = await sendWhatsapp(franchise, waIdOf(order.customer_phone), message);
    if (!sent) {
      await prisma.order.updateMany({ where: { id: order.id }, data: { magic_link_sent_at: null } });
      return false;
    }
    if (order.rider_id) emitTo(rooms.rider(order.rider_id), "magic_link_sent", { order_id: order.id });
    return true;
  } catch (error) {
    console.error("[whatsapp] magic link failed:", error.message);
    if (claimed) await prisma.order.updateMany({ where: { id: orderId }, data: { magic_link_sent_at: null } }).catch(() => {});
    return false;
  }
}
