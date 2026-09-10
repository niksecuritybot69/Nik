import { Telegraf } from "telegraf";
import { getChatConfig, saveChatConfig } from "../db";
import { requireAdmin, targetUserFromReplyOrArg, logToChannel } from "../utils";

const WARN_LIMIT = 5;

export function registerWarn(bot: Telegraf): void {
  bot.command("warn", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const targetId = targetUserFromReplyOrArg(ctx);
    if (!targetId) {
      return ctx.reply(
        "Reply to a user's message with /warn, or use /warn <user_id> / /warn @username."
      );
    }

    const chatId = ctx.chat.id;
    const config = getChatConfig(chatId);
    if (!config.warnings) config.warnings = {};

    const key = String(targetId);
    config.warnings[key] = (config.warnings[key] || 0) + 1;
    const count = config.warnings[key];

    if (count >= WARN_LIMIT) {
      config.warnings[key] = 0; // reset so a future unban doesn't start pre-warned
      saveChatConfig(chatId, config);
      try {
        await ctx.telegram.banChatMember(chatId, targetId);
        await ctx.reply(`🔨 User ${targetId} reached ${WARN_LIMIT} warnings and has been banned.`);
        await logToChannel(
          bot,
          `🔨 Auto-ban: user ${targetId} banned in chat ${chatId} after reaching ${WARN_LIMIT} warnings.`
        );
      } catch (err) {
        await ctx.reply(
          `User ${targetId} reached ${WARN_LIMIT} warnings but I couldn't ban them: ${(err as Error).message}`
        );
      }
      return;
    }

    saveChatConfig(chatId, config);
    await ctx.reply(`⚠️ Warning ${count}/${WARN_LIMIT} issued to user ${targetId}.`);
    await logToChannel(bot, `⚠️ User ${targetId} warned in chat ${chatId} (${count}/${WARN_LIMIT}).`);
  });
}
