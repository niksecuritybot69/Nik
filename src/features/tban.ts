import { Telegraf } from "telegraf";
import { requireAdmin, targetUserFromReplyOrArg, isReplyToMessage, parseDurationToSeconds, logToChannel } from "../utils";

export function registerTban(bot: Telegraf): void {
  bot.command("tban", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;

    const targetId = targetUserFromReplyOrArg(ctx);
    if (!targetId) {
      return ctx.reply(
        "Reply to a user's message with /tban <duration>, or use /tban <user_id> <duration>.\n" +
          "Examples: /tban 2d, /tban 30m, /tban 60s"
      );
    }

    const text = (ctx.message as any).text as string;
    const parts = text.split(" ");
    const durationArg = isReplyToMessage(ctx) ? parts[1] : parts[2];
    const seconds = parseDurationToSeconds(durationArg);

    if (!seconds || seconds <= 0) {
      return ctx.reply("Give a valid duration, e.g. /tban 2d, /tban 30m, /tban 60s.");
    }

    // Telegram treats an until_date less than 30 seconds away as a permanent
    // ban, not a temporary one — worth a heads-up rather than a silent surprise.
    if (seconds < 30) {
      await ctx.reply("⚠️ Note: Telegram treats bans under 30 seconds as permanent, not temporary.");
    }

    const chatId = ctx.chat.id;
    const untilDate = Math.floor(Date.now() / 1000) + seconds;

    try {
      await ctx.telegram.banChatMember(chatId, targetId, untilDate);
      await ctx.reply(`⏳ User ${targetId} has been temp-banned for ${durationArg}.`);
      await logToChannel(bot, `⏳ Temp-ban: user ${targetId} banned in chat ${chatId} for ${durationArg}.`);
    } catch (err) {
      await ctx.reply(`Couldn't temp-ban that user: ${(err as Error).message}`);
    }
  });
}
