import { Telegraf } from "telegraf";
import { getChatConfig, saveChatConfig } from "../db";
import { isUserAdmin, requireAdmin, logToChannel } from "../utils";

// Spammers often post a clean message then edit it to add spam/links after
// passing initial review. When enabled, this deletes any edited message from
// non-admins. Off by default per chat — admins opt in with /edit on.
export function registerEditGuardian(bot: Telegraf): void {
  bot.command("edit", async (ctx) => {
    if (!(await requireAdmin(ctx))) return;
    const arg = (ctx.message as any).text.split(" ")[1]?.toLowerCase();
    if (arg !== "on" && arg !== "off") {
      return ctx.reply("Usage: /edit on  |  /edit off\n(on = delete edited messages from non-admins)");
    }
    const config = getChatConfig(ctx.chat.id);
    config.editGuardianEnabled = arg === "on";
    saveChatConfig(ctx.chat.id, config);
    await ctx.reply(
      `✏️ Edit Guardian is now ${config.editGuardianEnabled ? "ON — edited messages will be deleted" : "OFF"}.`
    );
  });

  bot.on("edited_message", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const config = getChatConfig(chatId);
    if (!config.editGuardianEnabled) return;
    if (await isUserAdmin(ctx)) return;

    try {
      const editedMsg = (ctx.update as any).edited_message;
      await ctx.deleteMessage(editedMsg.message_id);
      await logToChannel(
        bot,
        `✏️ Edit Guardian: deleted an edited message from user ${ctx.from?.id} in chat ${chatId}.`
      );
    } catch {
      // ignore if bot lacks delete rights or message already gone
    }
  });
}
