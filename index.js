require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    MessageFlags
} = require("discord.js");

const cron = require("node-cron");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Channel Environment Variables
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID;                 // Event Announcements & Cron Pings
const EVENT_LOG_CHANNEL_ID = process.env.EVENT_LOG_CHANNEL_ID;         // Event Logs Submissions (〣🏆・event-logs)
const FAMILY_BALANCE_CHANNEL_ID = process.env.FAMILY_BALANCE_CHANNEL_ID; // Family Balance Logs Channel (┇・family-balance-logs)
const BONUS_LOG_CHANNEL_ID = process.env.BONUS_LOG_CHANNEL_ID;         // Bonus & Payout Logs Channel (〣💸・bonus-logs)

const BADMASH_ROLE = "💎Badmash";
const MOD_ROLES = [
    "Discord Moderator 🛠",
    "❤‍🔥CO Leader"
];

const DATA_FILE = "./data.json";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

/* =========================
   DEFAULT CONFIGURATIONS
========================= */

const DEFAULT_BONUSES = {
    "Cartel War": { kill: 3000, alive: 0, top: 0, parachute: 0, attendance: 0, killOnLoss: false },
    "Crown Holder": { kill: 3000, alive: 2000, top: 10000, parachute: 0, attendance: 0, killOnLoss: false },
    "Weapons Factory": { kill: 3000, alive: 0, top: 10000, parachute: 2000, attendance: 0, killOnLoss: false },
    "Biz War": { kill: 3000, alive: 2000, top: 10000, parachute: 0, attendance: 0, killOnLoss: false },
    "Clan Raid": { kill: 0, alive: 0, top: 0, parachute: 0, attendance: 2500, killOnLoss: false }
};

// Default events to populate if data.json is missing or empty
const DEFAULT_EVENTS = {
    "Cartel War": { times: ["15:00", "21:00"], days: null },
    "Crown Holder": { times: ["18:00"], days: null },
    "Weapons Factory": { times: ["13:00", "19:00"], days: null },
    "Biz War": { times: ["14:00", "20:00"], days: null },
    "Clan Raid": { times: ["17:00"], days: null }
};

/* =========================
   TIME PARSER HELPER (12h & 24h Safe)
========================= */

function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const clean = timeStr.trim().toUpperCase();
    const isPM = clean.includes("PM");
    const isAM = clean.includes("AM");

    const rawTime = clean.replace(/(AM|PM)/g, "").trim();
    const parts = rawTime.split(":");
    if (parts.length < 2) return null;

    let hour = parseInt(parts[0], 10);
    let minute = parseInt(parts[1], 10);

    if (isNaN(hour) || isNaN(minute)) return null;

    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;

    return hour * 60 + minute;
}

/* =========================
   DATA FUNCTIONS
========================= */

function loadData() {
    let initialData = {
        events: DEFAULT_EVENTS,
        bonuses: DEFAULT_BONUSES,
        familyBalance: 0,
        payouts: {}
    };

    if (!fs.existsSync(DATA_FILE)) {
        try {
            fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        } catch (err) {
            console.error("Could not write initial data.json:", err);
        }
        return initialData;
    }

    try {
        const fileData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
        fileData.bonuses = DEFAULT_BONUSES;
        if (fileData.familyBalance === undefined) fileData.familyBalance = 0;
        if (!fileData.payouts) fileData.payouts = {};
        if (!fileData.events || Object.keys(fileData.events).length === 0) {
            fileData.events = DEFAULT_EVENTS;
        }

        // Repair payouts (handles raw numbers vs objects)
        for (const [id, val] of Object.entries(fileData.payouts)) {
            if (typeof val === "number") {
                fileData.payouts[id] = { amount: val };
            }
        }

        // Repair events (handles raw time arrays vs event objects)
        for (const [name, val] of Object.entries(fileData.events)) {
            if (Array.isArray(val)) {
                fileData.events[name] = { times: val, days: null };
            }
        }

        return fileData;
    } catch (err) {
        console.error("Error reading data.json, falling back to defaults:", err);
        return initialData;
    }
}

function saveData(data) {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Failed to save data.json:", err);
    }
}

let data = loadData();

/* =========================
   HELPERS & PERMISSIONS
========================= */

function isModerator(interaction) {
    return interaction.member.roles.cache.some(
        role => MOD_ROLES.includes(role.name)
    );
}

function isFamilyBalanceChannel(interaction) {
    if (!FAMILY_BALANCE_CHANNEL_ID) return true;
    return interaction.channelId === FAMILY_BALANCE_CHANNEL_ID;
}

function isBonusLogChannel(interaction) {
    if (!BONUS_LOG_CHANNEL_ID) return true;
    return interaction.channelId === BONUS_LOG_CHANNEL_ID;
}

function getBonusForEvent(eventName) {
    if (!eventName) return null;
    const key = Object.keys(data.bonuses).find(
        k => k.toLowerCase() === eventName.trim().toLowerCase()
    );
    return key ? data.bonuses[key] : null;
}

function formatTime(time) {
    const mins = parseTimeToMinutes(time);
    if (mins === null) return time;
    let h = Math.floor(mins / 60);
    const m = mins % 60;
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    const mStr = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mStr} ${suffix}`;
}

function formatDays(days) {
    if (!days || !Array.isArray(days) || days.length === 0) return "Every day";
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days.map(day => names[day - 1] || "?").join(", ");
}

/* =========================
   SLASH COMMANDS
========================= */

const commands = [
    new SlashCommandBuilder()
        .setName("events")
        .setDescription("Show all scheduled events"),

    new SlashCommandBuilder()
        .setName("bonuses")
        .setDescription("Show payout policy rate for each event"),

    new SlashCommandBuilder()
        .setName("add-event")
        .setDescription("Add a new event")
        .addStringOption(option => option.setName("name").setDescription("Event name").setRequired(true))
        .addStringOption(option => option.setName("times").setDescription("Times in HH:MM format separated by commas").setRequired(true))
        .addStringOption(option => option.setName("days").setDescription("Optional days: 1=Mon, 2=Tue ... 7=Sun").setRequired(false)),

    new SlashCommandBuilder()
        .setName("edit-event")
        .setDescription("Edit an existing event")
        .addStringOption(option => option.setName("name").setDescription("Event name").setRequired(true))
        .addStringOption(option => option.setName("times").setDescription("Times in HH:MM separated by commas").setRequired(true))
        .addStringOption(option => option.setName("days").setDescription("Optional days: 1=Mon ... 7=Sun").setRequired(false)),

    new SlashCommandBuilder()
        .setName("remove-event")
        .setDescription("Remove an event")
        .addStringOption(option => option.setName("name").setDescription("Event name").setRequired(true)),

    new SlashCommandBuilder()
        .setName("submit-result")
        .setDescription("Submit event logs with kills and screenshot")
        .addStringOption(option =>
            option.setName("event")
                .setDescription("Select event name")
                .setRequired(true)
                .addChoices(
                    { name: "Cartel War", value: "Cartel War" },
                    { name: "Crown Holder", value: "Crown Holder" },
                    { name: "Weapons Factory", value: "Weapons Factory" },
                    { name: "Biz War", value: "Biz War" },
                    { name: "Clan Raid", value: "Clan Raid" }
                )
        )
        .addStringOption(option =>
            option.setName("status")
                .setDescription("Win or Loss")
                .setRequired(true)
                .addChoices(
                    { name: 'WIN', value: 'WIN' },
                    { name: 'LOSS', value: 'LOSS' }
                )
        )
        .addStringOption(option => option.setName("stats").setDescription("Format: @User 5, @User 3").setRequired(true))
        .addAttachmentOption(option => option.setName("screenshot").setDescription("Screenshot of the result").setRequired(true)),

    new SlashCommandBuilder()
        .setName("edit-result")
        .setDescription("Edit an existing event log")
        .addStringOption(option => option.setName("message_id").setDescription("Message ID of the log in event-logs").setRequired(true))
        .addStringOption(option =>
            option.setName("event")
                .setDescription("Select event name")
                .setRequired(false)
                .addChoices(
                    { name: "Cartel War", value: "Cartel War" },
                    { name: "Crown Holder", value: "Crown Holder" },
                    { name: "Weapons Factory", value: "Weapons Factory" },
                    { name: "Biz War", value: "Biz War" },
                    { name: "Clan Raid", value: "Clan Raid" }
                )
        )
        .addStringOption(option =>
            option.setName("status")
                .setDescription("Win or Loss")
                .setRequired(false)
                .addChoices(
                    { name: 'WIN', value: 'WIN' },
                    { name: 'LOSS', value: 'LOSS' }
                )
        )
        .addStringOption(option => option.setName("stats").setDescription("Format: @User 5, @User 3").setRequired(false))
        .addAttachmentOption(option => option.setName("screenshot").setDescription("New screenshot (replaces old)").setRequired(false)),

    new SlashCommandBuilder()
        .setName("payout")
        .setDescription("Check personal total accumulated payout or another member's payout")
        .addUserOption(option => option.setName("member").setDescription("Member to check").setRequired(false)),

    new SlashCommandBuilder()
        .setName("all-payouts")
        .setDescription("Show cumulative payout balances for all family members"),

    new SlashCommandBuilder()
        .setName("edit-payout")
        .setDescription("Add, subtract, or set exact payout balance for a member (Mod only)")
        .addStringOption(option => option.setName("action").setDescription("Operation").setRequired(true).addChoices(
            { name: "Add", value: "add" },
            { name: "Subtract", value: "subtract" },
            { name: "Set Exact", value: "set" }
        ))
        .addUserOption(option => option.setName("member").setDescription("Member").setRequired(true))
        .addIntegerOption(option => option.setName("amount").setDescription("Amount").setRequired(true).setMinValue(0)),

    new SlashCommandBuilder()
        .setName("family-balance")
        .setDescription("Check the current overall Family Balance"),

    new SlashCommandBuilder()
        .setName("edit-family-balance")
        .setDescription("Edit total Family Balance (Mod only)")
        .addStringOption(option => option.setName("action").setDescription("Operation").setRequired(true).addChoices(
            { name: "Add", value: "add" },
            { name: "Subtract", value: "subtract" },
            { name: "Set Exact", value: "set" }
        ))
        .addIntegerOption(option => option.setName("amount").setDescription("Amount").setRequired(true).setMinValue(0))
];

/* =========================
   REGISTER COMMANDS
========================= */

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
    try {
        console.log("Registering slash commands...");
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands.map(command => command.toJSON()) }
        );
        console.log("✅ Slash commands registered.");
    } catch (error) {
        console.error("❌ Command registration error:", error);
    }
}

/* =========================
   COMMAND HANDLERS
========================= */

async function showEvents(interaction) {
    if (!data.events || Object.keys(data.events).length === 0) {
        return await interaction.reply({ content: "ℹ️️ No events scheduled currently.", flags: MessageFlags.Ephemeral });
    }
    let message = "## 📅 Event Schedule\n\n";
    for (const [name, event] of Object.entries(data.events)) {
        const times = Array.isArray(event) ? event : (event?.times || []);
        const days = Array.isArray(event) ? null : (event?.days || null);

        message += `### ${name}\n`;
        message += times.length > 0 ? times.map(formatTime).join(" • ") : "No times set";
        message += `\n${formatDays(days)}\n\n`;
    }
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

async function showBonuses(interaction) {
    let message = "## 💰 Event Payout Policies\n\n";
    for (const [name, bonus] of Object.entries(data.bonuses)) {
        message += `### ${name}\n`;
        if (bonus.kill > 0) message += `🔫 Kill: $${bonus.kill.toLocaleString()}\n`;
        if (bonus.alive > 0) message += `❤️ Alive at end: $${bonus.alive.toLocaleString()}\n`;
        if (bonus.top > 0) message += `🏆 Top Shooter / Most Points: $${bonus.top.toLocaleString()}\n`;
        if (bonus.parachute > 0) message += `🪂 Parachute: $${bonus.parachute.toLocaleString()}\n`;
        if (bonus.attendance > 0) message += `👥 Attendance: $${bonus.attendance.toLocaleString()}\n`;
        message += `❌ Kill bonus on loss: ${bonus.killOnLoss ? "Yes" : "No"}\n\n`;
    }
    await interaction.reply({ content: message });
}

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    try {
        const modOnlyCommands = [
            "add-event", "edit-event", "remove-event", 
            "submit-result", "edit-result", "edit-payout", "edit-family-balance"
        ];

        if (modOnlyCommands.includes(command) && !isModerator(interaction)) {
            return interaction.reply({
                content: `❌ You need one of the moderator roles to use this command.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const familyBalanceCommands = ["family-balance", "edit-family-balance"];
        if (familyBalanceCommands.includes(command) && !isFamilyBalanceChannel(interaction)) {
            return interaction.reply({
                content: `❌ This command can only be used in <#${FAMILY_BALANCE_CHANNEL_ID}>.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const bonusLogCommands = ["payout", "all-payouts", "edit-payout"];
        if (bonusLogCommands.includes(command) && !isBonusLogChannel(interaction)) {
            return interaction.reply({
                content: `❌ This command can only be used in <#${BONUS_LOG_CHANNEL_ID}>.`,
                flags: MessageFlags.Ephemeral
            });
        }

        if (command === "events") return await showEvents(interaction);
        if (command === "bonuses") return await showBonuses(interaction);

        if (command === "family-balance") {
            return interaction.reply({
                content: `🏦 **Current Family Balance:** $${data.familyBalance.toLocaleString()}`
            });
        }

        if (command === "edit-family-balance") {
            const action = interaction.options.getString("action");
            const amount = interaction.options.getInteger("amount");

            if (action === "add") data.familyBalance += amount;
            else if (action === "subtract") data.familyBalance = Math.max(0, data.familyBalance - amount);
            else if (action === "set") data.familyBalance = amount;

            saveData(data);
            return interaction.reply(`🏛️ Family Balance updated (${action})! New Total: **$${data.familyBalance.toLocaleString()}**`);
        }

        if (command === "payout") {
            await interaction.deferReply();
            const member = interaction.options.getUser("member") || interaction.user;
            const record = data.payouts[member.id];
            const userPayout = typeof record === "number" ? record : (record?.amount || 0);

            return interaction.editReply({
                content: `💵 **Total Accumulated Payout for ${member}:** $${userPayout.toLocaleString()}`
            });
        }

        if (command === "all-payouts") {
            await interaction.deferReply();

            if (!data.payouts || Object.keys(data.payouts).length === 0) {
                return interaction.editReply({ content: "ℹ️ No member payouts recorded yet." });
            }

            let header = "## 📜 Cumulative Member Payout Balances\n\n";
            let currentChunk = header;

            for (const [id, info] of Object.entries(data.payouts)) {
                const amount = typeof info === "number" ? info : (info?.amount || 0);
                const line = `• <@${id}>: **$${amount.toLocaleString()}**\n`;

                if ((currentChunk + line).length > 1900) {
                    await interaction.followUp({ content: currentChunk });
                    currentChunk = "";
                }
                currentChunk += line;
            }

            if (currentChunk.length > 0) {
                return interaction.editReply({ content: currentChunk });
            }
        }

        if (command === "edit-payout") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const action = interaction.options.getString("action");
            const member = interaction.options.getUser("member");
            const amount = interaction.options.getInteger("amount");

            const record = data.payouts[member.id];
            let currentAmount = typeof record === "number" ? record : (record?.amount || 0);

            if (action === "add") currentAmount += amount;
            else if (action === "subtract") currentAmount = Math.max(0, currentAmount - amount);
            else if (action === "set") currentAmount = amount;

            data.payouts[member.id] = { amount: currentAmount };
            saveData(data);

            return interaction.editReply(`✅ Updated ${member}'s payout balance (${action}). New Total: **$${currentAmount.toLocaleString()}**`);
        }

        if (command === "submit-result") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const event = interaction.options.getString("event");
            const status = interaction.options.getString("status");
            const stats = interaction.options.getString("stats");
            const screenshot = interaction.options.getAttachment("screenshot");

            const bonus = getBonusForEvent(event);
            const isWin = status === "WIN";

            let statsFormatted = "Member | Kills | Earned Payout\n";
            const statPairs = stats.split(",");

            for (let pair of statPairs) {
                const parts = pair.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const kills = parseInt(parts.pop()) || 0;
                    const memberMention = parts.join(" ");

                    const userIdMatch = memberMention.match(/<@!?(\d+)>/);
                    let earnedPayout = 0;

                    if (bonus) {
                        if (isWin || bonus.killOnLoss) {
                            earnedPayout += kills * (bonus.kill || 0);
                        }
                        if (bonus.attendance > 0) {
                            earnedPayout += bonus.attendance;
                        }
                    }

                    if (userIdMatch) {
                        const userId = userIdMatch[1];
                        const record = data.payouts[userId];
                        let currentAmount = typeof record === "number" ? record : (record?.amount || 0);
                        
                        data.payouts[userId] = { amount: currentAmount + earnedPayout };
                    }

                    statsFormatted += `${memberMention} — ${kills} Kills — +$${earnedPayout.toLocaleString()}\n`;
                }
            }

            saveData(data);

            const messageContent = `🏆 **${event}**\n**Status:** ${status}\n\n${statsFormatted.trim()}`;
            const channel = await client.channels.fetch(EVENT_LOG_CHANNEL_ID).catch(() => null);

            if (!channel) {
                return interaction.editReply({ content: "❌ Event Log channel not found. Check EVENT_LOG_CHANNEL_ID in .env file." });
            }

            await channel.send({ content: messageContent, files: [screenshot.url] });
            return interaction.editReply({ content: "✅ Result submitted and member payouts automatically updated!" });
        }

        if (command === "edit-result") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const messageId = interaction.options.getString("message_id");
            const event = interaction.options.getString("event");
            const status = interaction.options.getString("status");
            const stats = interaction.options.getString("stats");
            const screenshot = interaction.options.getAttachment("screenshot");

            const channel = await client.channels.fetch(EVENT_LOG_CHANNEL_ID).catch(() => null);
            if (!channel) {
                return interaction.editReply({ content: "❌ Event Log channel not found. Check EVENT_LOG_CHANNEL_ID in .env file." });
            }

            let targetMessage;
            try {
                targetMessage = await channel.messages.fetch(messageId);
            } catch (error) {
                return interaction.editReply({ content: "❌ Could not find that message in event-logs channel. Verify the message ID." });
            }

            let newContent = targetMessage.content;

            if (event || status || stats) {
                const lines = targetMessage.content.split("\n");
                const currentEvent = lines[0] ? lines[0].replace("🏆 ", "").replace(/\*/g, "") : "";
                const currentStatus = lines[1] ? lines[1].replace("**Status:** ", "") : "";
                const currentStats = lines.slice(2).join("\n");

                const newEvent = event || currentEvent;
                const newStatus = status || currentStatus;
                let newStatsFormatted = currentStats;

                if (stats) {
                    newStatsFormatted = "Member | Kills\n";
                    const statPairs = stats.split(",");
                    for (let pair of statPairs) {
                        const parts = pair.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const kills = parts.pop();
                            const member = parts.join(" ");
                            newStatsFormatted += `${member} — ${kills} Kills\n`;
                        }
                    }
                    newStatsFormatted = newStatsFormatted.trim();
                }

                newContent = `🏆 **${newEvent}**\n**Status:** ${newStatus}\n\n${newStatsFormatted}`;
            }

            const payload = { content: newContent };
            if (screenshot) payload.files = [screenshot.url];

            await targetMessage.edit(payload);
            return interaction.editReply({ content: "✅ Result log updated successfully." });
        }

        if (command === "add-event") {
            const name = interaction.options.getString("name");
            const timesString = interaction.options.getString("times");
            const daysString = interaction.options.getString("days");

            if (data.events[name]) {
                return interaction.reply({ content: `❌ **${name}** already exists.`, flags: MessageFlags.Ephemeral });
            }
            const times = timesString.split(",").map(t => t.trim());
            let days = daysString ? daysString.split(",").map(Number) : null;

            data.events[name] = { times, days };
            saveData(data);
            return interaction.reply(`✅ Event **${name}** added.`);
        }

        if (command === "edit-event") {
            const name = interaction.options.getString("name");
            const timesString = interaction.options.getString("times");
            const daysString = interaction.options.getString("days");

            if (!data.events[name]) {
                return interaction.reply({ content: `❌ Event **${name}** doesn't exist.`, flags: MessageFlags.Ephemeral });
            }
            data.events[name].times = timesString.split(",").map(t => t.trim());
            data.events[name].days = daysString ? daysString.split(",").map(Number) : null;

            saveData(data);
            return interaction.reply(`✅ Event **${name}** updated.`);
        }

        if (command === "remove-event") {
            const name = interaction.options.getString("name");
            if (!data.events[name]) {
                return interaction.reply({ content: `❌ Event **${name}** doesn't exist.`, flags: MessageFlags.Ephemeral });
            }
            delete data.events[name];
            saveData(data);
            return interaction.reply(`🗑 Event **${name}** removed.`);
        }

    } catch (error) {
        console.error("Command Execution Error:", error);

        let errorText = "❌ There was an error processing this command.";
        if (error.code === 50013) {
            errorText = "❌ **Missing Permissions**: Check bot channel permissions.";
        }

        if (interaction.deferred) {
            await interaction.editReply({ content: errorText }).catch(() => {});
        } else if (interaction.replied) {
            await interaction.followUp({ content: errorText, flags: MessageFlags.Ephemeral }).catch(() => {});
        } else {
            await interaction.reply({ content: errorText, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
});

/* =========================
   AUTOMATIC EVENT SCHEDULER
========================= */

cron.schedule(
    "* * * * *",
    async () => {
        try {
            if (!data.events || Object.keys(data.events).length === 0) return;

            const now = new Date();
            const formatter = new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Kolkata",
                year: "numeric", month: "2-digit", day: "2-digit",
                hour: "2-digit", minute: "2-digit",
                weekday: "short", hour12: false
            });

            const parts = formatter.formatToParts(now);
            const getPart = type => parts.find(p => p.type === type)?.value;

            const currentHour = parseInt(getPart("hour"));
            const currentMinute = parseInt(getPart("minute"));
            const weekdayNumbers = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
            const currentDay = weekdayNumbers[getPart("weekday")];
            const currentTotal = currentHour * 60 + currentMinute;

            const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
            if (!guild) {
                console.error(`[Cron Error] Guild ID '${GUILD_ID}' not found.`);
                return;
            }

            const role = guild.roles.cache.find(r => r.name === BADMASH_ROLE);
            if (!role) {
                console.error(`[Cron Error] Role '${BADMASH_ROLE}' not found.`);
                return;
            }

            const channel = guild.channels.cache.get(EVENT_CHANNEL_ID) || await guild.channels.fetch(EVENT_CHANNEL_ID).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                console.error(`[Cron Error] Valid text channel '${EVENT_CHANNEL_ID}' not found.`);
                return;
            }

            for (const [eventName, event] of Object.entries(data.events)) {
                const times = Array.isArray(event) ? event : event?.times;
                const days = Array.isArray(event) ? null : event?.days;

                if (!times || !Array.isArray(times)) continue;

                for (const eventTime of times) {
                    const eventMinutes = parseTimeToMinutes(eventTime);
                    if (eventMinutes === null) continue;

                    let difference = eventMinutes - currentTotal;
                    if (difference < 0) difference += 24 * 60;

                    // Trigger at 15m warning, 10m warning, or exact start time
                    if (difference !== 15 && difference !== 10 && difference !== 0) continue;

                    if (days && Array.isArray(days) && days.length > 0) {
                        if (!days.includes(currentDay)) continue;
                    }

                    let message;
                    if (difference === 15) {
                        message = `⏰ **${eventName}** starts in **15 minutes!**\n\n${role}\nGet ready!`;
                    } else if (difference === 10) {
                        message = `⚠️ **${eventName}** starts in **10 minutes!**\n\n${role}\nGet ready!`;
                    } else {
                        message = `🔔 **${eventName}** is starting now!\n\n${role}\nGet ready!`;
                    }

                    await channel.send(message);
                    console.log(`✅ [Cron] Announced ${eventName} (${difference} min trigger)`);
                }
            }
        } catch (error) {
            console.error("[Cron System Error]:", error);
        }
    },
    { timezone: "Asia/Kolkata" }
);

/* =========================
   BOT READY
========================= */

client.once("ready", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🌏 Timezone: Asia/Kolkata`);
    console.log(`🔔 Event role: ${BADMASH_ROLE}`);
    console.log(`🔐 Moderator roles: ${MOD_ROLES.join(" | ")}`);

    await registerCommands();
});

/* =========================
   LOGIN
========================= */

client.login(TOKEN);