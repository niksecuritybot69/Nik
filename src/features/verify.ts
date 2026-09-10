import { Telegraf } from "telegraf";
import { getChatConfig, saveChatConfig } from "../db";
import { isUserInEnvList, escapeHtml, logToChannel } from "../utils";

function isVerifyAdmin(userId: number): boolean {
  return isUserInEnvList(userId, "VERIFY_ADMINS");
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

function formatUsername(raw: string): string {
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function verifiedMessage(address: string, type: string, belongsTo: string): string {
  return (
    `✅ <b>VERIFIED ADDRESS</b>\n\n` +
    `🛡 Address or upi : <code>${escapeHtml(address)}</code>\n` +
    `🛡 Type: ${escapeHtml(type)}\n` +
    `👤 Belongs To: ${escapeHtml(belongsTo)}\n\n` +
    `✅ This address is officially registered and safe to use.`
  );
}

export function registerVerify(bot: Telegraf): void {
  bot.command("verify", async (ctx) => {
    if (!ctx.from || !isVerifyAdmin(ctx.from.id)) {
      return ctx.reply("🚫 You're not authorized to use /verify.");
    }

    const usage =
      "Usage:\n" +
      "/verify upi <username> <address>\n" +
      "/verify crypto <network> <username> <address>\n" +
      "Example: /verify crypto USDT-BEP20 @seller 0xabc123...";

    const parts = (ctx.message as any).text.split(" ").slice(1);
    const kind = parts[0]?.toLowerCase();

    let type: string | undefined;
    let username: string | undefined;
    let address: string | undefined;

    if (kind === "upi") {
      username = parts[1];
      address = parts.slice(2).join(" ").trim();
      type = "UPI";
    } else if (kind === "crypto") {
      type = parts[1];
      username = parts[2];
      address = parts.slice(3).join(" ").trim();
    }

    if (!type || !username || !address) {
      return ctx.reply(usage);
    }

    const chatId = ctx.chat.id;
    const config = getChatConfig(chatId);
    const key = normalizeAddress(address);
    const belongsTo = formatUsername(username);
    const verifiedBy = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name;

    config.verifiedAddresses[key] = {
      type,
      belongsTo,
      verifiedBy,
      verifiedAt: new Date().toISOString(),
    };
    saveChatConfig(chatId, config);

    const reply = (ctx.message as any).reply_to_message;
    await ctx.replyWithHTML(
      verifiedMessage(address, type, belongsTo),
      reply ? { reply_parameters: { message_id: reply.message_id } } : (undefined as any)
    );

    await logToChannel(
      bot,
      `✅ VERIFY: ${verifiedBy} (${ctx.from.id}) registered a ${type} address in chat ${chatId} ` +
        `for ${belongsTo}: ${address}`
    );
  });

  bot.command("check", async (ctx) => {
    const parts = (ctx.message as any).text.split(" ").slice(1);
    const kind = parts[0]?.toLowerCase();
    const address = parts.slice(1).join(" ").trim();

    if ((kind !== "upi" && kind !== "crypto") || !address) {
      return ctx.reply("Usage: /check upi <address>  |  /check crypto <address>");
    }

    const config = getChatConfig(ctx.chat.id);
    const record = config.verifiedAddresses[normalizeAddress(address)];

    if (!record) {
      const label = kind === "upi" ? "UPI" : "crypto address";
      await ctx.reply(`⚠️ This is not a safe ${label}, be aware before dealing.`);
      return;
    }

    await ctx.replyWithHTML(verifiedMessage(address, record.type, record.belongsTo));
  });
}
