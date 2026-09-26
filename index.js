require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require("discord.js");

const cron = require("node-cron");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const BADMASH_ROLE = "💎Badmash";
const MOD_ROLE = "Discord Moderator 🛠";

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
        role => role.name === MOD_ROLE
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
            option
                .setName("name")
                .setDescription("Event name")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("times")
                .setDescription("Times in HH:MM format separated by commas")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("days")
                .setDescription("Optional days: 1=Mon, 2=Tue ... 7=Sun")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("edit-event")
        .setDescription("Edit an existing event")
        .addStringOption(option =>
            option
                .setName("name")
                .setDescription("Event name")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("times")
                .setDescription("Times in HH:MM separated by commas")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("days")
                .setDescription("Optional days: 1=Mon ... 7=Sun")
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName("remove-event")
        .setDescription("Remove an event")
        .addStringOption(option =>
            option
                .setName("name")
                .setDescription("Event name")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("set-bonus")
        .setDescription("Set bonuses for an event")
        .addStringOption(option =>
            option
                .setName("event")
                .setDescription("Event name")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("kill")
                .setDescription("Bonus per kill")
                .setRequired(true)
                .setMinValue(0)
        )
        .addIntegerOption(option =>
            option
                .setName("alive")
                .setDescription("Bonus for each member alive at end")
                .setRequired(true)
                .setMinValue(0)
        )
        .addIntegerOption(option =>
            option
                .setName("top")
                .setDescription("Top player bonus")
                .setRequired(true)
                .setMinValue(0)
        )
        .addIntegerOption(option =>
            option
                .setName("parachute")
                .setDescription("Bonus per parachute")
                .setRequired(true)
                .setMinValue(0)
        )
        .addIntegerOption(option =>
            option
                .setName("attendance")
                .setDescription("Attendance bonus")
                .setRequired(true)
                .setMinValue(0)
        )
        .addBooleanOption(option =>
            option
                .setName("kill_on_loss")
                .setDescription("Give kill bonuses even when losing?")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("remove-bonus")
        .setDescription("Remove bonuses for an event")
        .addStringOption(option =>
            option
                .setName("event")
                .setDescription("Event name")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("calculate-bonus")
        .setDescription("Calculate a player's event bonus")
        .addStringOption(option =>
            option
                .setName("event")
                .setDescription("Event name")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("kills")
                .setDescription("Number of kills")
                .setRequired(true)
                .setMinValue(0)
        )
        .addBooleanOption(option =>
            option
                .setName("won")
                .setDescription("Did the clan win?")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("alive")
                .setDescription("Was the player alive at the end?")
                .setRequired(true)
        )
        .addBooleanOption(option =>
            option
                .setName("top")
                .setDescription("Was the player eligible for the top-player bonus?")
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName("parachutes")
                .setDescription("Number of parachutes")
                .setRequired(true)
                .setMinValue(0)
        )
        .addIntegerOption(option =>
            option
                .setName("selfkills")
                .setDescription("Number of self-kills")
                .setRequired(true)
                .setMinValue(0)
        )
        .addBooleanOption(option =>
            option
                .setName("attended")
                .setDescription("Attended the event?")
                .setRequired(true)
        )
];

/* =========================
   REGISTER COMMANDS
========================= */

const rest = new REST({ version: "10" }).setToken(TOKEN);

async function registerCommands() {
    try {

        console.log("Registering slash commands...");

        await rest.put(
            Routes.applicationGuildCommands(
                CLIENT_ID,
                GUILD_ID
            ),
            {
                body: commands.map(command =>
                    command.toJSON()
                )
            }
        );

        console.log("✅ Slash commands registered.");

    } catch (error) {
        console.error("❌ Command registration error:");
        console.error(error);
    }
}

/* =========================
   EVENTS DISPLAY
========================= */

function formatTime(time) {

    const [hour, minute] = time.split(":");

    let h = parseInt(hour);

    const suffix = h >= 12 ? "PM" : "AM";

    h = h % 12;

    if (h === 0) {
        h = 12;
    }

    return `${h}:${minute} ${suffix}`;
}

function formatDays(days) {

    if (!days) {
        return "Every day";
    }

    const names = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday"
    ];

    return days
        .map(day => names[day - 1] || "?")
        .join(", ");
}

/* =========================
   EVENTS COMMAND
========================= */

async function showEvents(interaction) {

    let message = "## 📅 Event Schedule\n\n";

    for (const [name, event] of Object.entries(data.events)) {

        message += `### ${name}\n`;

        message += event.times
            .map(formatTime)
            .join(" • ");

        message += `\n${formatDays(event.days)}\n\n`;
    }

    await interaction.reply({
        content: message,
        ephemeral: false
    });
}

/* =========================
   BONUSES COMMAND
========================= */

async function showBonuses(interaction) {

    let message = "## 💰 Event Bonuses\n\n";

    for (const [name, bonus] of Object.entries(data.bonuses)) {

        message += `### ${name}\n`;

        if (bonus.kill > 0) {
            message += `🔫 Kill: $${bonus.kill.toLocaleString()}\n`;
        }

        if (bonus.alive > 0) {
            message += `❤️ Alive at end: $${bonus.alive.toLocaleString()}\n`;
        }

        if (bonus.top > 0) {
            message += `🏆 Top player: $${bonus.top.toLocaleString()}\n`;
        }

        if (bonus.parachute > 0) {
            message += `🪂 Parachute: $${bonus.parachute.toLocaleString()}\n`;
        }

        if (bonus.attendance > 0) {
            message += `👥 Attendance: $${bonus.attendance.toLocaleString()}\n`;
        }

        message += `❌ Kill bonus on loss: ${bonus.killOnLoss ? "Yes" : "No"}\n\n`;
    }

    message += "⚠️ Self-kill: no bonus for that kill + one additional kill bonus removed.";

    await interaction.reply({
        content: message
    });
}

/* =========================
   CALCULATE BONUS
========================= */

async function calculateBonus(interaction) {

    const eventName = interaction.options.getString("event");

    const bonus = data.bonuses[eventName];

    if (!bonus) {
        return interaction.reply({
            content: `❌ No bonus configuration found for **${eventName}**.`,
            ephemeral: true
        });
    }

    const kills = interaction.options.getInteger("kills");
    const won = interaction.options.getBoolean("won");
    const alive = interaction.options.getBoolean("alive");
    const top = interaction.options.getBoolean("top");
    const parachutes = interaction.options.getInteger("parachutes");
    const selfKills = interaction.options.getInteger("selfkills");
    const attended = interaction.options.getBoolean("attended");

    let total = 0;

    /* Kill bonus */

    if (won || bonus.killOnLoss) {

        let validKills = Math.max(
            0,
            kills - selfKills - selfKills
        );

        total += validKills * bonus.kill;

    }

    /* Alive bonus */

    if (alive) {
        total += bonus.alive;
    }

    /* Top player */

    if (top) {
        total += bonus.top;
    }

    /* Parachute */

    total += parachutes * bonus.parachute;

    /* Attendance */

    if (attended) {
        total += bonus.attendance;
    }

    await interaction.reply({
        content:
            `## 💰 Bonus Calculation\n\n` +
            `**Event:** ${eventName}\n` +
            `**Kills:** ${kills}\n` +
            `**Self-kills:** ${selfKills}\n` +
            `**Won:** ${won ? "Yes" : "No"}\n` +
            `**Alive:** ${alive ? "Yes" : "No"}\n` +
            `**Top player:** ${top ? "Yes" : "No"}\n` +
            `**Parachutes:** ${parachutes}\n` +
            `**Attended:** ${attended ? "Yes" : "No"}\n\n` +
            `### 💵 Total Bonus: **$${total.toLocaleString()}**`
    });
}

/* =========================
   COMMAND HANDLER
========================= */

client.on("interactionCreate", async interaction => {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    const command = interaction.commandName;

    try {

        /* Public commands */

        if (command === "events") {
            return showEvents(interaction);
        }

        if (command === "bonuses") {
            return showBonuses(interaction);
        }

        if (command === "calculate-bonus") {
            return calculateBonus(interaction);
        }

        /* Moderator commands */

        const managementCommands = [
            "add-event",
            "edit-event",
            "remove-event",
            "set-bonus",
            "remove-bonus"
        ];

        if (managementCommands.includes(command)) {

            if (!isModerator(interaction)) {

                return interaction.reply({
                    content:
                        `❌ You need the **${MOD_ROLE}** role to use this command.`,
                    ephemeral: true
                });

            }
        }

        /* ADD EVENT */

        if (command === "add-event") {

            const name =
                interaction.options.getString("name");

            const timesString =
                interaction.options.getString("times");

            const daysString =
                interaction.options.getString("days");

            if (data.events[name]) {

                return interaction.reply({
                    content: `❌ **${name}** already exists.`,
                    ephemeral: true
                });

            }

            const times = timesString
                .split(",")
                .map(t => t.trim());

            let days = null;

            if (daysString) {

                days = daysString
                    .split(",")
                    .map(Number);
            }

            data.events[name] = {
                times,
                days
            };

            saveData(data);

            return interaction.reply(
                `✅ Event **${name}** added.`
            );
        }

        /* EDIT EVENT */

        if (command === "edit-event") {

            const name =
                interaction.options.getString("name");

            const timesString =
                interaction.options.getString("times");

            const daysString =
                interaction.options.getString("days");

            if (!data.events[name]) {

                return interaction.reply({
                    content: `❌ Event **${name}** doesn't exist.`,
                    ephemeral: true
                });
            }

            data.events[name].times =
                timesString
                    .split(",")
                    .map(t => t.trim());

            data.events[name].days =
                daysString
                    ? daysString.split(",").map(Number)
                    : null;

            saveData(data);

            return interaction.reply(
                `✅ Event **${name}** updated.`
            );
        }

        /* REMOVE EVENT */

        if (command === "remove-event") {

            const name =
                interaction.options.getString("name");

            if (!data.events[name]) {

                return interaction.reply({
                    content: `❌ Event **${name}** doesn't exist.`,
                    ephemeral: true
                });
            }

            delete data.events[name];

            saveData(data);

            return interaction.reply(
                `🗑️ Event **${name}** removed.`
            );
        }

        /* SET BONUS */

        if (command === "set-bonus") {

            const event =
                interaction.options.getString("event");

            data.bonuses[event] = {

                kill:
                    interaction.options.getInteger("kill"),

                alive:
                    interaction.options.getInteger("alive"),

                top:
                    interaction.options.getInteger("top"),

                parachute:
                    interaction.options.getInteger("parachute"),

                attendance:
                    interaction.options.getInteger("attendance"),

                killOnLoss:
                    interaction.options.getBoolean("kill_on_loss")
            };

            saveData(data);

            return interaction.reply(
                `✅ Bonuses updated for **${event}**.`
            );
        }

        /* REMOVE BONUS */

        if (command === "remove-bonus") {

            const event =
                interaction.options.getString("event");

            if (!data.bonuses[event]) {

                return interaction.reply({
                    content: `❌ No bonus configuration found for **${event}**.`,
                    ephemeral: true
                });
            }

            data.bonuses[event] = {
                kill: 0,
                alive: 0,
                top: 0,
                parachute: 0,
                attendance: 0,
                killOnLoss: false
            };

            saveData(data);

            return interaction.reply(
                `🗑️ Bonuses removed for **${event}**.`
            );
        }

    } catch (error) {

        console.error(error);

        if (!interaction.replied) {

            await interaction.reply({
                content: "❌ Something went wrong. Check the bot console.",
                ephemeral: true
            });
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

        const formatter = new Intl.DateTimeFormat(
            "en-GB",
            {
                timeZone: "Asia/Kolkata",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                weekday: "short"
            }
        );

        const parts = formatter.formatToParts(now);

        const hour =
            parts.find(p => p.type === "hour").value;

        const minute =
            parts.find(p => p.type === "minute").value;

        const weekday =
            parts.find(p => p.type === "weekday").value;

        const currentTime = `${hour}:${minute}`;

        const weekdayNumbers = {
            Mon: 1,
            Tue: 2,
            Wed: 3,
            Thu: 4,
            Fri: 5,
            Sat: 6,
            Sun: 7
        };

        const currentDay =
            weekdayNumbers[weekday];

        for (const [eventName, event] of Object.entries(data.events)) {

            if (!event.times.includes(currentTime)) {
                continue;
            }

            if (
                event.days &&
                !event.days.includes(currentDay)
            ) {
                continue;
            }

            const guild = client.guilds.cache.get(GUILD_ID);

            if (!guild) {
                console.log("Guild not found.");
                continue;
            }

            const role =
                guild.roles.cache.find(
                    r => r.name === BADMASH_ROLE
                );

            if (!role) {
                console.log(
                    `Role ${BADMASH_ROLE} not found.`
                );

                continue;
            }

            const channel =
                guild.channels.cache.find(
                    channel =>
                        channel.isTextBased() &&
                        channel.permissionsFor(client.user).has("SendMessages")
                );

            if (!channel) {
                console.log(
                    "No usable text channel found."
                );

                continue;
            }

            await channel.send(
                `🔔 **${eventName}** is starting now!\n\n` +
                `${role}\n` +
                `Get ready!`
            );
        }

    },
    {
        timezone: "Asia/Kolkata"
    }
);

/* =========================
   BOT READY
========================= */

client.once("ready", async () => {

    console.log(
        `✅ Logged in as ${client.user.tag}`
    );

    console.log(
        `🌏 Timezone: Asia/Kolkata`
    );

    console.log(
        `🔔 Event role: ${BADMASH_ROLE}`
    );

    console.log(
        `🔐 Moderator role: ${MOD_ROLE}`
    );

    await registerCommands();
});

/* =========================
   LOGIN
========================= */

client.login(TOKEN);