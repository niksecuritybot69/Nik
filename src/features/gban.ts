import { Telegraf } from "telegraf";
import { getAllChatConfigs, addGlobalBan, removeGlobalBan, isGloballyBanned } from "../db";
import { isUserInEnvList, logToChannel } from "../utils";

// Only user IDs listed in OWNER_IDS (comma-separated, in the env) can run
// these — this is deliberately not "group admin", since it acts across
// every group the bot is in, not just the one it's used in.
function isGbanOwner(userId: number): boolean {
  return isUserInEnvList(userId, "OWNER_IDS");
}

function targetFromArgs(ctx: any): number | null {
  const reply = ctx.message?.reply_to_message;
  if (reply?.from?.id) return reply.from.id;
  const arg = ctx.message?.text?.split(" ")[1];
  if (arg && /^\d+$/.test(arg)) return parseInt(arg, 10);
  return null;
}

export function registerGban(bot: Telegraf): void {
  bot.command("gban", async (ctx) => {
    if (!ctx.from || !isGbanOwner(ctx.from.id)) {
      return ctx.reply("🚫 Only bot owners (OWNER_IDS) can use /gban.");
    }

    const targetId = targetFromArgs(ctx);
    if (!targetId) {
      return ctx.reply("Reply to a user's message with /gban [reason], or use /gban <user_id> [reason].");
    }

    const isReply = Boolean((ctx.message as any).reply_to_message);
    const text = (ctx.message as any).text as string;
    const reasonParts = isReply ? text.split(" ").slice(1) : text.split(" ").slice(2);
    const reason = reasonParts.join(" ").trim() || "No reason given";

    addGlobalBan(targetId, reason, ctx.from.id);

    const allChats = getAllChatConfigs();
    let banned = 0;
    let failed = 0;
    for (const chatIdStr of Object.keys(allChats)) {
      try {
        await ctx.telegram.banChatMember(parseInt(chatIdStr, 10), targetId);
        banned++;
      } catch {
        failed++;
      }
    }

    await ctx.reply(
      `🌐 User ${targetId} has been globally banned.\n` +
        `Banned in ${banned} group(s)${failed ? `, failed in ${failed}` : ""}.\n` +
        `Reason: ${reason}`
    );
    await logToChannel(
      bot,
      `🌐 GBAN: user ${targetId} globally banned by ${ctx.from.id}.\nReason: ${reason}\nBanned in ${banned} group(s).`
    );
  });

  // A ban list with no way back is a foot-gun, so this ships alongside /gban
  // as its direct counterpart.
  bot.command("ungban", async (ctx) => {
    if (!ctx.from || !isGbanOwner(ctx.from.id)) {
      return ctx.reply("🚫 Only bot owners (OWNER_IDS) can use /ungban.");
    }

    const targetId = targetFromArgs(ctx);
    if (!targetId) {
      return ctx.reply("Reply to a user's message with /ungban, or use /ungban <user_id>.");
    }

    removeGlobalBan(targetId);

    const allChats = getAllChatConfigs();
    for (const chatIdStr of Object.keys(allChats)) {
      try {
        await ctx.telegram.unbanChatMember(parseInt(chatIdStr, 10), targetId, { only_if_banned: true });
      } catch {
        // ignore — e.g. wasn't banned in that particular group
      }
    }

    await ctx.reply(`✅ User ${targetId} has been removed from the global ban list.`);
    await logToChannel(bot, `✅ UNGBAN: user ${targetId} un-globally-banned by ${ctx.from.id}.`);
  });

  // Defensive catch-all: if a globally-banned user posts in a group — e.g.
  // the bot joined that group after the gban happened, or the original ban
  // call above failed for some reason — this catches it and bans them there
  // too, so a gban stays enforced even in groups it didn't originally cover.
  bot.on("message", async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || ctx.chat.type === "private") return next();
    if (!isGloballyBanned(userId)) return next();

    try {
      await ctx.deleteMessage();
    } catch {
      // ignore
    }
    try {
      await ctx.telegram.banChatMember(ctx.chat.id, userId);
    } catch {
      // ignore
    }
    // message handled (deleted), don't pass along to other handlers
  });
}
