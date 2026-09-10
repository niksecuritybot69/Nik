import { Telegraf } from "telegraf";
import { isUserInEnvList, escapeHtml, logToChannel } from "../utils";

// Only user IDs listed in VERIFY_ADMINS (comma-separated, in the env) can
// post a verified address — deliberately separate from "group admin", since
// in an escrow/trading context you often want a smaller, trusted circle for
// this specific action than for general moderation.
function isVerifyAdmin(userId: number): boolean {
  return isUserInEnvList(userId, "VERIFY_ADMINS");
}

export function registerVerify(bot: Telegraf): void {
  bot.command("verify", async (ctx) => {
    if (!ctx.from || !isVerifyAdmin(ctx.from.id)) {
      return ctx.reply("🚫 You're not authorized to use /verify.");
    }

    const parts = (ctx.message as any).text.split(" ").slice(1);
    const type = parts[0]?.toLowerCase();
    const address = parts.slice(1).join(" ").trim();

    if ((type !== "upi" && type !== "crypto") || !address) {
      return ctx.reply("Usage: /verify upi <address>  |  /verify crypto <address>");
    }

    const label = type === "upi" ? "UPI ID" : "Crypto Address";
    const verifiedBy = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

    const msg =
      `✅ <b>VERIFIED ${label}</b>\n\n` +
      `<code>${escapeHtml(address)}</code>\n\n` +
      `Confirmed by ${escapeHtml(verifiedBy)}. Always double-check the address matches ` +
      `exactly before sending any funds — this confirmation does not cover addresses ` +
      `sent to you elsewhere, only this exact one.`;

    const reply = (ctx.message as any).reply_to_message;
    await ctx.replyWithHTML(msg, reply ? { reply_parameters: { message_id: reply.message_id } } : undefined as any);

    await logToChannel(
      bot,
      `✅ VERIFY: ${verifiedBy} (${ctx.from.id}) verified a ${label} in chat ${ctx.chat.id}: ${address}`
    );
  });
}
