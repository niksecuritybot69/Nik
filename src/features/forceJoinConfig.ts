import { Telegraf } from "telegraf";
import { getChatConfig, saveChatConfig } from "../db";
import { requireAdmin } from "../utils";

// Shared logic for /setjoin (slot 1) and /setjoin2 (slot 2). `slot` picks
// which pair of config fields (forceJoinChannel[2] / forceJoinInviteLink[2])
// gets written to.
async function handleSetJoin(ctx: any, slot: 1 | 2): Promise<any> {
  if (!(await requireAdmin(ctx))) return;
  const commandName = slot === 1 ? "setjoin" : "setjoin2";
  const channelField = slot === 1 ? "forceJoinChannel" : "forceJoinChannel2";
  const linkField = slot === 1 ? "forceJoinInviteLink" : "forceJoinInviteLink2";
  const label = slot === 1 ? "1st" : "2nd";

  const parts = (ctx.message as any).text.split(" ").slice(1);
  const arg = parts[0];
  const config = getChatConfig(ctx.chat.id);
  const reply = (ctx.message as any).reply_to_message;
  const forwardedChat = reply?.forward_from_chat;

  if (arg && arg.toLowerCase() === "off") {
    (config as any)[channelField] = null;
    (config as any)[linkField] = null;
    saveChatConfig(ctx.chat.id, config);
    return ctx.reply(`✅ Force Join (${label} channel) disabled.`);
  }

  // Easiest path for private channels: forward any post from the channel
  // into this group, then reply to that forward with /setjoin (no args).
  // No need to hunt down the numeric ID yourself.
  if (!arg && forwardedChat) {
    const channelId = String(forwardedChat.id);
    let inviteLink: string | undefined = forwardedChat.username
      ? `https://t.me/${forwardedChat.username}`
      : undefined;

    if (!inviteLink) {
      try {
        inviteLink = await ctx.telegram.exportChatInviteLink(channelId);
      } catch {
        return ctx.reply(
          `I detected the channel ("${forwardedChat.title}") from your forward, but couldn't generate ` +
            "an invite link automatically — I need to be an admin there with invite permissions.\n\n" +
            `Add me as admin to that channel, then reply to the forward with /${commandName} again.`
        );
      }
    }

    (config as any)[channelField] = channelId;
    (config as any)[linkField] = inviteLink;
    saveChatConfig(ctx.chat.id, config);
    return ctx.reply(
      `✅ Force Join (${label} channel) enabled for "${forwardedChat.title}" (auto-detected from your forward).`
    );
  }

  if (!arg) {
    return ctx.reply(
      "Usage:\n" +
        `• Public channel: /${commandName} @channelusername\n` +
        `• Private channel (easiest): forward a post from the channel here, then reply to it with /${commandName}\n` +
        `• Private channel (manual): /${commandName} <channel_id> <invite_link>\n` +
        `• Disable: /${commandName} off\n\n` +
        "Either way, I need to be an admin of the target channel to check who's joined."
    );
  }

  // Public channel: /setjoin @channelusername
  if (arg.startsWith("@")) {
    (config as any)[channelField] = arg;
    (config as any)[linkField] = `https://t.me/${arg.replace("@", "")}`;
    saveChatConfig(ctx.chat.id, config);
    return ctx.reply(`✅ Force Join (${label} channel) enabled: users must join ${arg} before posting.`);
  }

  // Private channel, manual: /setjoin -1001234567890 https://t.me/+inviteHash
  if (/^-?\d+$/.test(arg)) {
    const channelId = arg;
    let inviteLink = parts[1];

    if (!inviteLink) {
      try {
        inviteLink = await ctx.telegram.exportChatInviteLink(channelId);
      } catch {
        return ctx.reply(
          "This looks like a private channel ID, but I couldn't auto-generate an invite link " +
            "(I may not be an admin there with invite permissions).\n\n" +
            `Usage: /${commandName} <channel_id> <invite_link>\n` +
            `Tip: forwarding a post from the channel and replying /${commandName} is easier than typing the ID.`
        );
      }
    }

    (config as any)[channelField] = channelId;
    (config as any)[linkField] = inviteLink;
    saveChatConfig(ctx.chat.id, config);
    return ctx.reply(`✅ Force Join (${label} channel) enabled for private channel. Users must join before posting.`);
  }

  return ctx.reply(
    "Usage:\n" +
      `• Public channel: /${commandName} @channelusername\n` +
      `• Private channel (easiest): forward a post from the channel here, then reply to it with /${commandName}\n` +
      `• Private channel (manual): /${commandName} <channel_id> <invite_link>\n` +
      `• Disable: /${commandName} off`
  );
}

export function registerForceJoinConfig(bot: Telegraf): void {
  // 1st required channel (original behavior, unchanged commands/usage)
  bot.command("setjoin", async (ctx) => {
    await handleSetJoin(ctx, 1);
  });

  // 2nd required channel — users must join BOTH channels to post.
  bot.command("setjoin2", async (ctx) => {
    await handleSetJoin(ctx, 2);
  });
}
