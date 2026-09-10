import { Telegraf } from "telegraf";
import { getChatConfig, saveChatConfig } from "../db";
import { requireAdmin, isUserAdmin, logToChannel } from "../utils";

// True only for messages forwarded from a CHANNEL — not forwards of a
// regular user's message, and not messages auto-posted by a linked channel
// into its discussion group (that's a channel post, a different shape).
function isForwardedFromChannel(msg: any): boolean {
  // Bot API 7.0+ (Dec 2023) moved forward info into `forward_origin`.
  const origin = msg.forward_origin;
  if (origin) return origin.type === "channel";
  // Fallback for any older shape a client library might still surface.
  return Boolean(msg.forward_from_chat && msg.forward_from_chat.type === "channel");
}

export function registerAntiForward(bot: Telegraf): void {
  bot.command("anti4ward", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const arg = (ctx.message as any).text.split(" ")[1]?.toLowerCase();
    if (arg !== "on" && arg !== "off") {
      return ctx.reply("Usage: /anti4ward on  |  /anti4ward off\n(deletes messages forwarded from channels)");
    }
    const config = getChatConfig(ctx.chat.id);
    config.antiForwardEnabled = arg === "on";
    saveChatConfig(ctx.chat.id, config);
    await ctx.reply(
      `📡 Anti-Forward is now ${config.antiForwardEnabled ? "ON — channel forwards will be deleted" : "OFF"}.`
    );
  });

  bot.on("message", async (ctx, next) => {
    const config = getChatConfig(ctx.chat.id);
    if (!config.antiForwardEnabled) return next();

    const msg: any = ctx.message;
    if (!isForwardedFromChannel(msg)) return next();
    if (await isUserAdmin(ctx)) return next();

    try {
      await ctx.deleteMessage();
      await logToChannel(
        bot,
        `📡 Anti-Forward: deleted a channel-forwarded message from user ${ctx.from?.id} in chat ${ctx.chat.id}.`
      );
    } catch {
      // ignore if bot lacks delete rights or message already gone
    }
    // don't call next() — message is gone
  });
}
