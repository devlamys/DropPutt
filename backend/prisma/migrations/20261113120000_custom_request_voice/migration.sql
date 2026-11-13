-- Voice note a customer records for a "Buy Anything" request ("get me the usual
-- tablets from City Medicals"). Kept apart from voice_note_url, which holds the
-- customer's recorded directions to their house and is overwritten by the
-- Magic Link page.
ALTER TABLE "orders" ADD COLUMN "request_voice_url" TEXT;
