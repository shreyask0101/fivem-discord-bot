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
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID;

const BADMASH_ROLE = "💎Badmash";
const MOD_ROLES = [
    "Discord Moderator 🛠",
    "❤️‍🔥CO Leader"
];

const DATA_FILE = "./data.json";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

/* =========================
   DATA FUNCTIONS
========================= */

function loadData() {
    if (!fs.existsSync(DATA_FILE)) {
        return {
            events: {},
            bonuses: {}
        };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function saveData(data) {
    fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(data, null, 2)
    );
}

let data = loadData();

/* =========================
   PERMISSION CHECK
========================= */

function isModerator(interaction) {
    return interaction.member.roles.cache.some(
        role => MOD_ROLES.includes(role.name)
    );
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
        .setDescription("Show all event bonuses"),

    new SlashCommandBuilder()
        .setName("add-event")
        .setDescription("Add a new event")
        .addStringOption(option =>
            option.setName("name").setDescription("Event name").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("times").setDescription("Times in HH:MM format separated by commas").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("days").setDescription("Optional days: 1=Mon, 2=Tue ... 7=Sun").setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("edit-event")
        .setDescription("Edit an existing event")
        .addStringOption(option =>
            option.setName("name").setDescription("Event name").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("times").setDescription("Times in HH:MM separated by commas").setRequired(true)
        )
        .addStringOption(option =>
            option.setName("days").setDescription("Optional days: 1=Mon ... 7=Sun").setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("remove-event")
        .setDescription("Remove an event")
        .addStringOption(option =>
            option.setName("name").setDescription("Event name").setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("set-bonus")
        .setDescription("Set bonuses for an event")
        .addStringOption(option => option.setName("event").setDescription("Event name").setRequired(true))
        .addIntegerOption(option => option.setName("kill").setDescription("Bonus per kill").setRequired(true).setMinValue(0))
        .addIntegerOption(option => option.setName("alive").setDescription("Bonus for each member alive at end").setRequired(true).setMinValue(0))
        .addIntegerOption(option => option.setName("top").setDescription("Top player bonus").setRequired(true).setMinValue(0))
        .addIntegerOption(option => option.setName("parachute").setDescription("Bonus per parachute").setRequired(true).setMinValue(0))
        .addIntegerOption(option => option.setName("attendance").setDescription("Attendance bonus").setRequired(true).setMinValue(0))
        .addBooleanOption(option => option.setName("kill_on_loss").setDescription("Give kill bonuses even when losing?").setRequired(true)),

    new SlashCommandBuilder()
        .setName("remove-bonus")
        .setDescription("Remove bonuses for an event")
        .addStringOption(option => option.setName("event").setDescription("Event name").setRequired(true)),

    new SlashCommandBuilder()
        .setName("calculate-bonus")
        .setDescription("Calculate a player's event bonus")
        .addStringOption(option => option.setName("event").setDescription("Event name").setRequired(true))
        .addIntegerOption(option => option.setName("kills").setDescription("Number of kills").setRequired(true).setMinValue(0))
        .addBooleanOption(option => option.setName("won").setDescription("Did the clan win?").setRequired(true))
        .addBooleanOption(option => option.setName("alive").setDescription("Was the player alive at the end?").setRequired(true))
        .addBooleanOption(option => option.setName("top").setDescription("Was the player eligible for the top-player bonus?").setRequired(true))
        .addIntegerOption(option => option.setName("parachutes").setDescription("Number of parachutes").setRequired(true).setMinValue(0))
        .addIntegerOption(option => option.setName("selfkills").setDescription("Number of self-kills").setRequired(true).setMinValue(0))
        .addBooleanOption(option => option.setName("attended").setDescription("Attended the event?").setRequired(true)),

    new SlashCommandBuilder()
        .setName("submit-result")
        .setDescription("Submit event logs with kills and screenshot")
        .addStringOption(option => option.setName("event").setDescription("Event name (e.g. Business War)").setRequired(true))
        .addStringOption(option => option.setName("status").setDescription("Win or Loss").setRequired(true).addChoices({ name: 'WIN', value: 'WIN' }, { name: 'LOSS', value: 'LOSS' }))
        .addStringOption(option => option.setName("stats").setDescription("Format: @User 5, @User 3").setRequired(true))
        .addAttachmentOption(option => option.setName("screenshot").setDescription("Screenshot of the result").setRequired(true)),

    new SlashCommandBuilder()
        .setName("edit-result")
        .setDescription("Edit an existing event log")
        .addStringOption(option => option.setName("message_id").setDescription("Message ID of the log in event-logs").setRequired(true))
        .addStringOption(option => option.setName("event").setDescription("Event name").setRequired(false))
        .addStringOption(option => option.setName("status").setDescription("Win or Loss").setRequired(false).addChoices({ name: 'WIN', value: 'WIN' }, { name: 'LOSS', value: 'LOSS' }))
        .addStringOption(option => option.setName("stats").setDescription("Format: @User 5, @User 3").setRequired(false))
        .addAttachmentOption(option => option.setName("screenshot").setDescription("New screenshot (replaces old)").setRequired(false)),
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
        console.error("❌ Command registration error:");
        console.error(error);
    }
}

/* =========================
   EVENTS DISPLAY HELPERS
========================= */

function formatTime(time) {
    const [hour, minute] = time.split(":");
    let h = parseInt(hour);
    const suffix = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${minute} ${suffix}`;
}

function formatDays(days) {
    if (!days) return "Every day";
    const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return days.map(day => names[day - 1] || "?").join(", ");
}

/* =========================
   COMMAND HANDLERS
========================= */

async function showEvents(interaction) {
    let message = "## 📅 Event Schedule\n\n";
    for (const [name, event] of Object.entries(data.events)) {
        message += `### ${name}\n`;
        message += event.times.map(formatTime).join(" • ");
        message += `\n${formatDays(event.days)}\n\n`;
    }
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
}

async function showBonuses(interaction) {
    let message = "## 💰 Event Bonuses\n\n";
    for (const [name, bonus] of Object.entries(data.bonuses)) {
        message += `### ${name}\n`;
        if (bonus.kill > 0) message += `🔫 Kill: $${bonus.kill.toLocaleString()}\n`;
        if (bonus.alive > 0) message += `❤️ Alive at end: $${bonus.alive.toLocaleString()}\n`;
        if (bonus.top > 0) message += `🏆 Top player: $${bonus.top.toLocaleString()}\n`;
        if (bonus.parachute > 0) message += `🪂 Parachute: $${bonus.parachute.toLocaleString()}\n`;
        if (bonus.attendance > 0) message += `👥 Attendance: $${bonus.attendance.toLocaleString()}\n`;
        message += `❌ Kill bonus on loss: ${bonus.killOnLoss ? "Yes" : "No"}\n\n`;
    }
    message += "⚠️ Self-kill: no bonus for that kill + one additional kill bonus removed.";
    await interaction.reply({ content: message });
}

async function calculateBonus(interaction) {
    const eventName = interaction.options.getString("event");
    const bonus = data.bonuses[eventName];
    if (!bonus) {
        return interaction.reply({ content: `❌ No bonus configuration found for **${eventName}**.`, flags: MessageFlags.Ephemeral });
    }

    const kills = interaction.options.getInteger("kills");
    const won = interaction.options.getBoolean("won");
    const alive = interaction.options.getBoolean("alive");
    const top = interaction.options.getBoolean("top");
    const parachutes = interaction.options.getInteger("parachutes");
    const selfKills = interaction.options.getInteger("selfkills");
    const attended = interaction.options.getBoolean("attended");

    let total = 0;
    if (won || bonus.killOnLoss) {
        let validKills = Math.max(0, kills - selfKills - selfKills);
        total += validKills * bonus.kill;
    }
    if (alive) total += bonus.alive;
    if (top) total += bonus.top;
    total += parachutes * bonus.parachute;
    if (attended) total += bonus.attendance;

    await interaction.reply({
        content: `## 💰 Bonus Calculation\n\n**Event:** ${eventName}\n**Kills:** ${kills}\n**Self-kills:** ${selfKills}\n**Won:** ${won ? "Yes" : "No"}\n**Alive:** ${alive ? "Yes" : "No"}\n**Top player:** ${top ? "Yes" : "No"}\n**Parachutes:** ${parachutes}\n**Attended:** ${attended ? "Yes" : "No"}\n\n### 💵 Total Bonus: **$${total.toLocaleString()}**`
    });
}

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    try {
        const managementCommands = [
            "add-event", "edit-event", "remove-event", "set-bonus", "remove-bonus", 
            "submit-result", "edit-result"
        ];

        if (managementCommands.includes(command)) {
            if (!isModerator(interaction)) {
                return interaction.reply({
                    content: `❌ You need one of the moderator roles to use this command.`,
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        if (command === "events") return await showEvents(interaction);
        if (command === "bonuses") return await showBonuses(interaction);
        if (command === "calculate-bonus") return await calculateBonus(interaction);

        /* --- SUBMIT RESULT --- */
        if (command === "submit-result") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const event = interaction.options.getString("event");
            const status = interaction.options.getString("status");
            const stats = interaction.options.getString("stats");
            const screenshot = interaction.options.getAttachment("screenshot");

            let statsFormatted = "Member\nKills\n";
            const statPairs = stats.split(",");
            for (let pair of statPairs) {
                const parts = pair.trim().split(/\s+/);
                if (parts.length >= 2) {
                    const kills = parts.pop();
                    const member = parts.join(" ");
                    statsFormatted += `${member}\n${kills}\n`;
                }
            }

            const messageContent = `🏆 ${event}\n${status}\n${statsFormatted.trim()}`;
            const channel = await client.channels.fetch(EVENT_CHANNEL_ID).catch(() => null);

            if (!channel) {
                return interaction.editReply({ content: "❌ Event channel not found or bot lacks access." });
            }

            await channel.send({ content: messageContent, files: [screenshot.url] });
            return interaction.editReply({ content: "✅ Result submitted successfully." });
        }

        /* --- EDIT RESULT --- */
        if (command === "edit-result") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });

            const messageId = interaction.options.getString("message_id");
            const event = interaction.options.getString("event");
            const status = interaction.options.getString("status");
            const stats = interaction.options.getString("stats");
            const screenshot = interaction.options.getAttachment("screenshot");

            const channel = await client.channels.fetch(EVENT_CHANNEL_ID).catch(() => null);
            if (!channel) {
                return interaction.editReply({ content: "❌ Event channel not found or bot lacks access." });
            }

            let targetMessage;
            try {
                targetMessage = await channel.messages.fetch(messageId);
            } catch (error) {
                return interaction.editReply({ content: "❌ Could not find that message in event-logs. Check the message ID." });
            }

            let newContent = targetMessage.content;

            if (event || status || stats) {
                const lines = targetMessage.content.split("\n");
                const currentEvent = lines[0] ? lines[0].replace("🏆 ", "") : "";
                const currentStatus = lines[1] || "";
                const currentStats = lines.slice(2).join("\n");

                const newEvent = event || currentEvent;
                const newStatus = status || currentStatus;
                let newStatsFormatted = currentStats;

                if (stats) {
                    newStatsFormatted = "Member\nKills\n";
                    const statPairs = stats.split(",");
                    for (let pair of statPairs) {
                        const parts = pair.trim().split(/\s+/);
                        if (parts.length >= 2) {
                            const kills = parts.pop();
                            const member = parts.join(" ");
                            newStatsFormatted += `${member}\n${kills}\n`;
                        }
                    }
                    newStatsFormatted = newStatsFormatted.trim();
                }

                newContent = `🏆 ${newEvent}\n${newStatus}\n${newStatsFormatted}`;
            }

            const payload = { content: newContent };
            if (screenshot) payload.files = [screenshot.url];

            await targetMessage.edit(payload);
            return interaction.editReply({ content: "✅ Result updated successfully." });
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
            return interaction.reply(`🗑️ Event **${name}** removed.`);
        }

        if (command === "set-bonus") {
            const event = interaction.options.getString("event");
            data.bonuses[event] = {
                kill: interaction.options.getInteger("kill"),
                alive: interaction.options.getInteger("alive"),
                top: interaction.options.getInteger("top"),
                parachute: interaction.options.getInteger("parachute"),
                attendance: interaction.options.getInteger("attendance"),
                killOnLoss: interaction.options.getBoolean("kill_on_loss")
            };
            saveData(data);
            return interaction.reply(`✅ Bonuses updated for **${event}**.`);
        }

        if (command === "remove-bonus") {
            const event = interaction.options.getString("event");
            if (!data.bonuses[event]) {
                return interaction.reply({ content: `❌ No bonus configuration found for **${event}**.`, flags: MessageFlags.Ephemeral });
            }
            data.bonuses[event] = { kill: 0, alive: 0, top: 0, parachute: 0, attendance: 0, killOnLoss: false };
            saveData(data);
            return interaction.reply(`🗑️ Bonuses removed for **${event}**.`);
        }

    } catch (error) {
        console.error("Command Execution Error:", error);

        let errorText = "❌ There was an error processing this command.";
        if (error.code === 50013) {
            errorText = "❌ **Missing Permissions**: The bot lacks permission to post or attach files in the event channel. Check channel settings in Discord.";
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

        const guild = client.guilds.cache.get(GUILD_ID);
        if (!guild) return;

        const role = guild.roles.cache.find(r => r.name === BADMASH_ROLE);
        if (!role) return;

        const channel = guild.channels.cache.get(EVENT_CHANNEL_ID);
        if (!channel) return;
        if (!channel.isTextBased() || !channel.permissionsFor(client.user).has("SendMessages")) return;

        function getTimeDifference(eventTime) {
            const [eventHour, eventMinute] = eventTime.split(":").map(Number);
            let currentTotal = currentHour * 60 + currentMinute;
            let eventTotal = eventHour * 60 + eventMinute;
            let difference = eventTotal - currentTotal;
            if (difference < 0) difference += 24 * 60;
            return difference;
        }

        for (const [eventName, event] of Object.entries(data.events)) {
            for (const eventTime of event.times) {
                const difference = getTimeDifference(eventTime);

                if (eventName === "Cartel War") {
                    if (difference !== 0) continue;
                }

                if (difference !== 15 && difference !== 10 && difference !== 0) continue;
                if (event.days) {
                    if (!event.days.includes(currentDay)) continue;
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
            }
        }
    },
    { timezone: "Asia/Kolkata" }
);

/* =========================
   BOT READY
========================= */

client.once("clientReady", async () => {
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