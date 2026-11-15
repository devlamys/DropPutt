// Status updates to customers who ordered on WhatsApp. Best-effort and silent
// for web orders: it never throws, so it can be called after any commit.
// Inside WhatsApp's 24-hour customer-service window these are free-form
// messages, so no approved templates are needed.

import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
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
    await sendWhatsapp(order.franchise, waIdOf(order.customer_phone), text(body));
  } catch (error) {
    console.error("[whatsapp] notify failed:", error.message);
  }
}
