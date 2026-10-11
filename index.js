require("dotenv").config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    MessageFlags,
    EmbedBuilder
} = require("discord.js");

const {
    joinVoiceChannel,
    createAudioPlayer,
    createAudioResource,
    AudioPlayerStatus
} = require("@discordjs/voice");

const play = require("play-dl");
const googleTTS = require("google-tts-api");
const cron = require("node-cron");
const fs = require("fs");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Channel Environment Variables
const EVENT_CHANNEL_ID = process.env.EVENT_CHANNEL_ID;
const EVENT_LOG_CHANNEL_ID = process.env.EVENT_LOG_CHANNEL_ID;
const FAMILY_BALANCE_CHANNEL_ID = process.env.FAMILY_BALANCE_CHANNEL_ID;
const BONUS_LOG_CHANNEL_ID = process.env.BONUS_LOG_CHANNEL_ID;

const BADMASH_ROLE = "💎Badmash";
const MOD_ROLES = [
    "Discord Moderator 🛠",
    "❤‍🔥CO Leader"
];

const DATA_FILE = "./data.json";

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

/* =========================
   MUSIC & TTS STATE STORAGE
========================= */

const musicQueues = new Map();
const ttsSessions = new Map();
const purgeTasks = new Map();

/* =========================
   IST CLAN EVENT CONFIGURATIONS
========================= */

const DEFAULT_BONUSES = {
    "Weapons Factory": { kill: 3000, alive: 0, top: 10000, parachute: 2000, attendance: 0, killOnLoss: false },
    "Business War": { kill: 3000, alive: 2000, top: 10000, parachute: 0, attendance: 0, killOnLoss: false },
    "Crown Event": { kill: 3000, alive: 2000, top: 10000, parachute: 0, attendance: 0, killOnLoss: false },
    "Cartel War": { kill: 3000, alive: 0, top: 0, parachute: 0, attendance: 0, killOnLoss: false },
    "Clan Showdown": { kill: 0, alive: 0, top: 0, parachute: 0, attendance: 2500, killOnLoss: false }
};

const DEFAULT_EVENTS = {
    "Weapons Factory": { times: ["03:30", "17:30"], days: null },
    "Business War": { times: ["01:30", "19:30"], days: null },
    "Crown Event": { times: ["02:30", "14:30", "20:30"], days: null },
    "Cartel War": {
        times: [
            "00:00", "01:00", "02:00", "03:00", "04:00", "05:00",
            "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
            "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
            "18:00", "19:00", "20:00", "21:00", "22:00", "23:00"
        ],
        days: null
    },
    "Clan Showdown": { times: ["22:00"], days: [6] }
};

/* =========================
   TIME & DATE HELPERS
========================= */

function parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== "string") return null;
    const clean = timeStr.trim().toUpperCase();
    const isPM = clean.includes("PM");
    const isAM = clean.includes("AM");

    const rawTime = clean.replace(/(AM|PM)/g, "").trim();
    const parts = rawTime.split(":");

    let hour = parseInt(parts[0], 10);
    let minute = parts.length > 1 ? parseInt(parts[1], 10) : 0;

    if (isNaN(hour) || isNaN(minute)) return null;

    if (isPM && hour < 12) hour += 12;
    if (isAM && hour === 12) hour = 0;

    return hour * 60 + minute;
}

function getISTTime() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Kolkata",
        hour: "numeric",
        minute: "numeric",
        weekday: "short",
        hour12: false,
        hourCycle: "h23"
    });

    const parts = formatter.formatToParts(now);
    const getPart = type => parts.find(p => p.type === type)?.value;

    const hour = parseInt(getPart("hour"), 10);
    const minute = parseInt(getPart("minute"), 10);
    const weekday = getPart("weekday") ? getPart("weekday").replace(".", "") : "Mon";

    const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const currentDay = weekdayMap[weekday] || 1;

    return {
        hour,
        minute,
        totalMinutes: hour * 60 + minute,
        currentDay,
        timeString: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`
    };
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
    return `${h}:${mStr}${suffix}`;
}

function formatDays(days) {
    if (!days || !Array.isArray(days) || days.length === 0) return "Every day";
    const names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    return days.map(day => names[day - 1] || "?").join(", ");
}

/* =========================
   DATA MANAGEMENT
========================= */

function loadData() {
    let initialData = {
        events: DEFAULT_EVENTS,
        bonuses: DEFAULT_BONUSES,
        familyBalance: 0,
        payouts: {},
        kills: {},
        applications: {},
        settings: { disabledLogs: [], logChannel: null }
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
        fileData.events = DEFAULT_EVENTS;
        fileData.bonuses = DEFAULT_BONUSES;
        if (fileData.familyBalance === undefined) fileData.familyBalance = 0;
        if (!fileData.payouts) fileData.payouts = {};
        if (!fileData.kills) fileData.kills = {};
        if (!fileData.applications) fileData.applications = {};
        if (!fileData.settings) fileData.settings = { disabledLogs: [], logChannel: null };

        fs.writeFileSync(DATA_FILE, JSON.stringify(fileData, null, 2));
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
   PERMISSIONS & HELPERS
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

async function playNextSong(guildId) {
    const queueData = musicQueues.get(guildId);
    if (!queueData || queueData.queue.length === 0) {
        queueData.current = null;
        return;
    }

    const track = queueData.queue.shift();
    queueData.current = track;

    try {
        const stream = await play.stream(track.url);
        const resource = createAudioResource(stream.stream, { inputType: stream.type, inlineVolume: true });
        resource.volume.setVolume(queueData.volume);
        queueData.player.play(resource);
    } catch (err) {
        console.error("Music Playback Error:", err);
        playNextSong(guildId);
    }
}

/* =========================
   SLASH COMMAND DEFINITIONS
========================= */

const commands = [
    // NEW FEATURES & MODULES
    new SlashCommandBuilder().setName("help").setDescription("View Badmash commands"),
    new SlashCommandBuilder().setName("apply").setDescription("Request your clan roles from High Command")
        .addStringOption(opt => opt.setName("reason").setDescription("Why do you want to join?").setRequired(true)),
    new SlashCommandBuilder().setName("status").setDescription("Check your latest application status"),
    new SlashCommandBuilder().setName("kills").setDescription("View approved clan kills and leaderboard"),
    new SlashCommandBuilder().setName("reset_kills").setDescription("HC: clear one member kills after paying their bonus")
        .addUserOption(opt => opt.setName("member").setDescription("Member to reset").setRequired(true)),
    new SlashCommandBuilder().setName("slots").setDescription("Find the current hourly signup and next notification time"),

    // SETTINGS & LOGGING
    new SlashCommandBuilder().setName("setup").setDescription("Configure Badmash for your server")
        .addChannelOption(opt => opt.setName("log_channel").setDescription("Channel for bot activity logs").setRequired(true)),
    new SlashCommandBuilder().setName("settings").setDescription("View configured channels and bot permissions"),
    new SlashCommandBuilder().setName("disable_log").setDescription("Disable one optional activity log")
        .addStringOption(opt => opt.setName("log_type").setDescription("Log type to toggle").setRequired(true)),

    // PURGE SUBCOMMANDS
    new SlashCommandBuilder().setName("purge")
        .setDescription("Channel message cleanup options")
        .addSubcommand(sub => sub.setName("all").setDescription("Delete all messages in this channel after confirmation"))
        .addSubcommand(sub => sub.setName("cancel").setDescription("Stop an ongoing cleanup"))
        .addSubcommand(sub => sub.setName("status").setDescription("Check cleanup progress in this channel")),

    // MUSIC COMMANDS
    new SlashCommandBuilder().setName("play").setDescription("Play a YouTube song in your voice channel")
        .addStringOption(opt => opt.setName("query").setDescription("Song name or YouTube URL").setRequired(true)),
    new SlashCommandBuilder().setName("pause").setDescription("Pause the current song"),
    new SlashCommandBuilder().setName("resume").setDescription("Resume music"),
    new SlashCommandBuilder().setName("skip").setDescription("Skip the current song"),
    new SlashCommandBuilder().setName("stop").setDescription("Stop music, clear the queue and leave voice"),
    new SlashCommandBuilder().setName("nowplaying").setDescription("Show the current song"),
    new SlashCommandBuilder().setName("queue").setDescription("View the music queue"),
    new SlashCommandBuilder().setName("volume").setDescription("Set music volume")
        .addIntegerOption(opt => opt.setName("level").setDescription("Volume (1-100)").setRequired(true).setMinValue(1).setMaxValue(100)),

    // TTS COMMANDS
    new SlashCommandBuilder().setName("tts")
        .setDescription("Text-To-Speech voice chat features")
        .addSubcommand(sub => sub.setName("join").setDescription("Join your VC and read messages from its chat"))
        .addSubcommand(sub => sub.setName("leave").setDescription("Stop reading VC chat and disconnect"))
        .addSubcommand(sub => sub.setName("skip").setDescription("Skip the current spoken message")),

    // EXISTING EVENTS & PAYOUT COMMANDS
    new SlashCommandBuilder().setName("events").setDescription("Show all scheduled events"),
    new SlashCommandBuilder().setName("bonuses").setDescription("Show payout policy rate for each event"),
    new SlashCommandBuilder().setName("test-ping").setDescription("Send a test ping message to the event channel (Mod only)"),
    new SlashCommandBuilder().setName("check-schedule").setDescription("Check current bot IST time and upcoming event ping countdowns"),
    new SlashCommandBuilder().setName("add-event").setDescription("Add a new event")
        .addStringOption(option => option.setName("name").setDescription("Event name").setRequired(true))
        .addStringOption(option => option.setName("times").setDescription("Times in HH:MM format separated by commas").setRequired(true))
        .addStringOption(option => option.setName("days").setDescription("Optional days: 1=Mon, 2=Tue ... 7=Sun").setRequired(false)),
    new SlashCommandBuilder().setName("edit-event").setDescription("Edit an existing event")
        .addStringOption(option => option.setName("name").setDescription("Event name").setRequired(true))
        .addStringOption(option => option.setName("times").setDescription("Times in HH:MM separated by commas").setRequired(true))
        .addStringOption(option => option.setName("days").setDescription("Optional days: 1=Mon ... 7=Sun").setRequired(false)),
    new SlashCommandBuilder().setName("remove-event").setDescription("Remove an event")
        .addStringOption(option => option.setName("name").setDescription("Event name").setRequired(true)),
    new SlashCommandBuilder().setName("submit-result").setDescription("Submit event logs with kills and screenshot")
        .addStringOption(option => option.setName("event").setDescription("Select event name").setRequired(true).addChoices(
            { name: "Weapons Factory", value: "Weapons Factory" }, { name: "Business War", value: "Business War" },
            { name: "Crown Event", value: "Crown Event" }, { name: "Cartel War", value: "Cartel War" }, { name: "Clan Showdown", value: "Clan Showdown" }
        ))
        .addStringOption(option => option.setName("status").setDescription("Win or Loss").setRequired(true).addChoices({ name: 'WIN', value: 'WIN' }, { name: 'LOSS', value: 'LOSS' }))
        .addStringOption(option => option.setName("stats").setDescription("Format: @User 5, @User 3").setRequired(true))
        .addAttachmentOption(option => option.setName("screenshot").setDescription("Screenshot of the result").setRequired(true)),
    new SlashCommandBuilder().setName("edit-result").setDescription("Edit an existing event log")
        .addStringOption(option => option.setName("message_id").setDescription("Message ID").setRequired(true))
        .addStringOption(option => option.setName("event").setDescription("Select event name").setRequired(false).addChoices(
            { name: "Weapons Factory", value: "Weapons Factory" }, { name: "Business War", value: "Business War" },
            { name: "Crown Event", value: "Crown Event" }, { name: "Cartel War", value: "Cartel War" }, { name: "Clan Showdown", value: "Clan Showdown" }
        ))
        .addStringOption(option => option.setName("status").setDescription("Win or Loss").setRequired(false).addChoices({ name: 'WIN', value: 'WIN' }, { name: 'LOSS', value: 'LOSS' }))
        .addStringOption(option => option.setName("stats").setDescription("Format: @User 5, @User 3").setRequired(false))
        .addAttachmentOption(option => option.setName("screenshot").setDescription("New screenshot").setRequired(false)),
    new SlashCommandBuilder().setName("payout").setDescription("Check personal total accumulated payout or another member's payout")
        .addUserOption(option => option.setName("member").setDescription("Member to check").setRequired(false)),
    new SlashCommandBuilder().setName("all-payouts").setDescription("Show cumulative payout balances for all family members"),
    new SlashCommandBuilder().setName("edit-payout").setDescription("Add, subtract, or set exact payout balance for a member (Mod only)")
        .addStringOption(option => option.setName("action").setDescription("Operation").setRequired(true).addChoices({ name: "Add", value: "add" }, { name: "Subtract", value: "subtract" }, { name: "Set Exact", value: "set" }))
        .addUserOption(option => option.setName("member").setDescription("Member").setRequired(true))
        .addIntegerOption(option => option.setName("amount").setDescription("Amount").setRequired(true).setMinValue(0)),
    new SlashCommandBuilder().setName("family-balance").setDescription("Check the current overall Family Balance"),
    new SlashCommandBuilder().setName("edit-family-balance").setDescription("Edit total Family Balance (Mod only)")
        .addStringOption(option => option.setName("action").setDescription("Operation").setRequired(true).addChoices({ name: "Add", value: "add" }, { name: "Subtract", value: "subtract" }, { name: "Set Exact", value: "set" }))
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

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const subcommand = interaction.options.getSubcommand(false);

    try {
        const modOnlyCommands = [
            "add-event", "edit-event", "remove-event", 
            "submit-result", "edit-result", "edit-payout", "edit-family-balance", "test-ping",
            "setup", "disable_log", "purge", "reset_kills"
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

        // --- NEW MODULE COMMANDS ---
        if (command === "help") {
            const embed = new EmbedBuilder()
                .setTitle("🔥 Badmash Clan Bot Commands")
                .setColor(0xFF0000)
                .setDescription("Overview of all available clan, music, moderation, and event commands.")
                .addFields(
                    { name: "🛡 Clan & Roles", value: "`/apply` • `/status` • `/kills` • `/reset_kills` • `/slots`" },
                    { name: "⚙️ Setup & Logs", value: "`/setup` • `/settings` • `/disable_log`" },
                    { name: "🧹 Moderation", value: "`/purge all` • `/purge cancel` • `/purge status`" },
                    { name: "🎵 Music Player", value: "`/play` • `/pause` • `/resume` • `/skip` • `/stop` • `/queue` • `/nowplaying` • `/volume`" },
                    { name: "🗣 Text-To-Speech", value: "`/tts join` • `/tts leave` • `/tts skip`" },
                    { name: "📅 Events & Payouts", value: "`/events` • `/bonuses` • `/submit-result` • `/payout` • `/all-payouts` • `/family-balance`" }
                );
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

        if (command === "apply") {
            const reason = interaction.options.getString("reason");
            data.applications[interaction.user.id] = { status: "Pending", reason, date: new Date().toISOString() };
            saveData(data);
            return interaction.reply({ content: "✅ Role application submitted to High Command for review!", flags: MessageFlags.Ephemeral });
        }

        if (command === "status") {
            const app = data.applications[interaction.user.id];
            if (!app) return interaction.reply({ content: "ℹ️ You have no active application.", flags: MessageFlags.Ephemeral });
            return interaction.reply({ content: `📋 **Application Status:** ${app.status}\n**Submitted:** ${app.date}\n**Note:** ${app.reason}`, flags: MessageFlags.Ephemeral });
        }

        if (command === "kills") {
            let leaderboard = "🏆 **Clan Kills Leaderboard**\n\n";
            const sorted = Object.entries(data.kills).sort((a, b) => b[1] - a[1]);
            if (sorted.length === 0) leaderboard += "No kills recorded yet.";
            else sorted.forEach(([id, count], idx) => leaderboard += `${idx + 1}. <@${id}> — **${count} Kills**\n`);
            return interaction.reply({ content: leaderboard });
        }

        if (command === "reset_kills") {
            const member = interaction.options.getUser("member");
            data.kills[member.id] = 0;
            saveData(data);
            return interaction.reply({ content: `✅ Cleared kills balance for ${member}.` });
        }

        if (command === "slots") {
            const ist = getISTTime();
            const nextHour = (ist.hour + 1) % 24;
            return interaction.reply({ content: `🕒 **Current Hourly Signup Window:** Active\n⏰ **Next Notification:** \`${nextHour.toString().padStart(2, '0')}:00 IST\`` });
        }

        if (command === "setup") {
            const channel = interaction.options.getChannel("log_channel");
            data.settings.logChannel = channel.id;
            saveData(data);
            return interaction.reply({ content: `✅ Bot activity log channel updated to ${channel}.` });
        }

        if (command === "settings") {
            return interaction.reply({ content: `⚙️ **Bot Settings**\n• Log Channel: <#${data.settings.logChannel || "None"}>\n• Disabled Logs: ${data.settings.disabledLogs.join(", ") || "None"}`, flags: MessageFlags.Ephemeral });
        }

        if (command === "disable_log") {
            const type = interaction.options.getString("log_type");
            if (!data.settings.disabledLogs.includes(type)) data.settings.disabledLogs.push(type);
            saveData(data);
            return interaction.reply({ content: `✅ Log type \`${type}\` disabled.` });
        }

        if (command === "purge") {
            if (subcommand === "all") {
                await interaction.reply({ content: "🧹 Starting channel purge... Hold tight!" });
                purgeTasks.set(interaction.channelId, { active: true, deleted: 0 });

                let deletedCount = 0;
                while (purgeTasks.get(interaction.channelId)?.active) {
                    const fetched = await interaction.channel.messages.fetch({ limit: 100 }).catch(() => null);
                    if (!fetched || fetched.size === 0) break;

                    const deleted = await interaction.channel.bulkDelete(fetched, true).catch(() => null);
                    if (!deleted || deleted.size === 0) break;

                    deletedCount += deleted.size;
                    purgeTasks.get(interaction.channelId).deleted = deletedCount;
                }

                purgeTasks.delete(interaction.channelId);
                return interaction.followUp({ content: `✅ Channel purge completed! Removed **${deletedCount}** messages.` });
            }

            if (subcommand === "cancel") {
                const task = purgeTasks.get(interaction.channelId);
                if (!task) return interaction.reply({ content: "ℹ️ No active purge task in this channel.", flags: MessageFlags.Ephemeral });
                task.active = false;
                return interaction.reply({ content: "🛑 Purge operation canceled." });
            }

            if (subcommand === "status") {
                const task = purgeTasks.get(interaction.channelId);
                if (!task) return interaction.reply({ content: "ℹ️ No active purge task in this channel.", flags: MessageFlags.Ephemeral });
                return interaction.reply({ content: `🧹 **Purge Progress:** Deleted **${task.deleted}** messages so far...` });
            }
        }

        // --- MUSIC COMMANDS ---
        if (command === "play") {
            const voiceChannel = interaction.member.voice.channel;
            if (!voiceChannel) return interaction.reply({ content: "❌ Join a voice channel first!", flags: MessageFlags.Ephemeral });

            await interaction.deferReply();
            const query = interaction.options.getString("query");
            const searchResult = await play.search(query, { limit: 1 });

            if (!searchResult || searchResult.length === 0) return interaction.editReply("❌ No song found.");

            const track = { title: searchResult[0].title, url: searchResult[0].url, duration: searchResult[0].durationRaw };
            let queueData = musicQueues.get(interaction.guildId);

            if (!queueData) {
                const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
                const player = createAudioPlayer();
                connection.subscribe(player);

                queueData = { queue: [], player, connection, volume: 1.0, current: null };
                musicQueues.set(interaction.guildId, queueData);

                player.on(AudioPlayerStatus.Idle, () => playNextSong(interaction.guildId));
            }

            queueData.queue.push(track);
            if (!queueData.current && queueData.player.state.status === AudioPlayerStatus.Idle) {
                playNextSong(interaction.guildId);
                return interaction.editReply(`🎶 Now playing: **${track.title}**`);
            }

            return interaction.editReply(`➕ Added to queue: **${track.title}**`);
        }

        if (command === "pause") {
            const queueData = musicQueues.get(interaction.guildId);
            if (queueData?.player) queueData.player.pause();
            return interaction.reply({ content: "⏸ Music paused." });
        }

        if (command === "resume") {
            const queueData = musicQueues.get(interaction.guildId);
            if (queueData?.player) queueData.player.unpause();
            return interaction.reply({ content: "▶️ Music resumed." });
        }

        if (command === "skip") {
            const queueData = musicQueues.get(interaction.guildId);
            if (queueData?.player) queueData.player.stop();
            return interaction.reply({ content: "⏭ Song skipped." });
        }

        if (command === "stop") {
            const queueData = musicQueues.get(interaction.guildId);
            if (queueData) {
                queueData.queue = [];
                queueData.player.stop();
                queueData.connection.destroy();
                musicQueues.delete(interaction.guildId);
            }
            return interaction.reply({ content: "⏹ Music stopped and left voice channel." });
        }

        if (command === "nowplaying") {
            const queueData = musicQueues.get(interaction.guildId);
            if (!queueData?.current) return interaction.reply({ content: "ℹ️ No music currently playing.", flags: MessageFlags.Ephemeral });
            return interaction.reply({ content: `🎧 **Now Playing:** ${queueData.current.title} [${queueData.current.duration}]` });
        }

        if (command === "queue") {
            const queueData = musicQueues.get(interaction.guildId);
            if (!queueData || queueData.queue.length === 0) return interaction.reply({ content: "ℹ️ Music queue is empty.", flags: MessageFlags.Ephemeral });
            let msg = "📜 **Music Queue:**\n";
            queueData.queue.forEach((t, i) => msg += `${i + 1}. ${t.title}\n`);
            return interaction.reply({ content: msg });
        }

        if (command === "volume") {
            const level = interaction.options.getInteger("level");
            const queueData = musicQueues.get(interaction.guildId);
            if (queueData) queueData.volume = level / 100;
            return interaction.reply({ content: `🔊 Volume set to **${level}%**` });
        }

        // --- TTS COMMANDS ---
        if (command === "tts") {
            if (subcommand === "join") {
                const voiceChannel = interaction.member.voice.channel;
                if (!voiceChannel) return interaction.reply({ content: "❌ Join a voice channel first!", flags: MessageFlags.Ephemeral });

                const connection = joinVoiceChannel({ channelId: voiceChannel.id, guildId: interaction.guildId, adapterCreator: interaction.guild.voiceAdapterCreator });
                const player = createAudioPlayer();
                connection.subscribe(player);

                ttsSessions.set(interaction.guildId, { connection, player, queue: [] });
                return interaction.reply({ content: `🎙 **TTS Joined <#${voiceChannel.id}>!** Reading chat messages...` });
            }

            if (subcommand === "leave") {
                const session = ttsSessions.get(interaction.guildId);
                if (session) {
                    session.connection.destroy();
                    ttsSessions.delete(interaction.guildId);
                }
                return interaction.reply({ content: "🔌 TTS disconnected." });
            }

            if (subcommand === "skip") {
                const session = ttsSessions.get(interaction.guildId);
                if (session?.player) session.player.stop();
                return interaction.reply({ content: "⏭ TTS message skipped." });
            }
        }

        // --- EXISTING CORE COMMANDS ---
        if (command === "events") {
            data = loadData();
            if (!data.events || Object.keys(data.events).length === 0) {
                return await interaction.reply({ content: "ℹ️ No events scheduled currently.", flags: MessageFlags.Ephemeral });
            }
            let message = "## 📅 Event Schedule (IST)\n\n";
            for (const [name, event] of Object.entries(data.events)) {
                const times = Array.isArray(event) ? event : (event?.times || []);
                const days = Array.isArray(event) ? null : (event?.days || null);
                message += `### ${name}\n`;
                message += times.length > 0 ? times.map(formatTime).join(" • ") : "No times set";
                message += `\n${formatDays(days)}\n\n`;
            }
            return await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }

        if (command === "bonuses") {
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
            return await interaction.reply({ content: message });
        }

        if (command === "check-schedule") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            data = loadData();
            const ist = getISTTime();
            let msg = `🕒 **Current Bot IST Time:** \`${ist.timeString}\` (Day ${ist.currentDay})\n\n`;
            if (!data.events || Object.keys(data.events).length === 0) {
                msg += "❌ No events found in schedule.";
            } else {
                msg += "📋 **Upcoming Event Ping Countdowns:**\n";
                for (const [eventName, event] of Object.entries(data.events)) {
                    const times = Array.isArray(event) ? event : event?.times;
                    if (!times || !Array.isArray(times)) continue;
                    for (const eventTime of times) {
                        const eventMins = parseTimeToMinutes(eventTime);
                        if (eventMins === null) continue;
                        let diff = eventMins - ist.totalMinutes;
                        if (diff < 0) diff += 24 * 60;
                        msg += `• **${eventName}** (${formatTime(eventTime)}) — Next ping in **${diff} minutes**\n`;
                    }
                }
            }
            return interaction.editReply(msg);
        }

        if (command === "test-ping") {
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const channel = await client.channels.fetch(EVENT_CHANNEL_ID).catch(() => null);
            if (!channel || !channel.isTextBased()) {
                return interaction.editReply(`❌ Could not fetch channel \`${EVENT_CHANNEL_ID}\`. Check EVENT_CHANNEL_ID in .env file.`);
            }
            const guild = interaction.guild;
            const role = guild.roles.cache.find(r => r.name.trim().toLowerCase() === BADMASH_ROLE.trim().toLowerCase());
            const rolePing = role ? `${role}` : `@${BADMASH_ROLE}`;
            await channel.send(`🧪 **Test Announcement Ping**\n\n${rolePing}\nIf you see this, channel permissions & notifications are working!`);
            return interaction.editReply(`✅ Test message sent to <#${EVENT_CHANNEL_ID}>!`);
        }

        if (command === "family-balance") {
            return interaction.reply({ content: `🏦 **Current Family Balance:** $${data.familyBalance.toLocaleString()}` });
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
            return interaction.editReply({ content: `💵 **Total Accumulated Payout for ${member}:** $${userPayout.toLocaleString()}` });
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
            if (currentChunk.length > 0) return interaction.editReply({ content: currentChunk });
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
                        if (isWin || bonus.killOnLoss) earnedPayout += kills * (bonus.kill || 0);
                        if (bonus.attendance > 0) earnedPayout += bonus.attendance;
                    }

                    if (userIdMatch) {
                        const userId = userIdMatch[1];
                        data.kills[userId] = (data.kills[userId] || 0) + kills;
                        const record = data.payouts[userId];
                        let currentAmount = typeof record === "number" ? record : (record?.amount || 0);
                        data.payouts[userId] = { amount: currentAmount + earnedPayout };
                    }
                    statsFormatted += `${memberMention} — ${kills} Kills — +$${earnedPayout.toLocaleString()}\n`;
                }
            }

            saveData(data);
            const channel = await client.channels.fetch(EVENT_LOG_CHANNEL_ID).catch(() => null);
            if (channel) await channel.send({ content: `🏆 **${event}**\n**Status:** ${status}\n\n${statsFormatted.trim()}`, files: [screenshot.url] });
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
            if (!channel) return interaction.editReply({ content: "❌ Event Log channel not found." });

            let targetMessage;
            try {
                targetMessage = await channel.messages.fetch(messageId);
            } catch (error) {
                return interaction.editReply({ content: "❌ Could not find that message in event-logs channel." });
            }

            let newContent = targetMessage.content;
            if (event || status || stats) {
                const lines = targetMessage.content.split("\n");
                const currentEvent = lines[0] ? lines[0].replace("🏆 ", "").replace(/\*/g, "") : "";
                const currentStatus = lines[1] ? lines[1].replace("**Status:** ", "") : "";
                const newEvent = event || currentEvent;
                const newStatus = status || currentStatus;
                let newStatsFormatted = lines.slice(2).join("\n");

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
            if (data.events[name]) return interaction.reply({ content: `❌ **${name}** already exists.`, flags: MessageFlags.Ephemeral });
            data.events[name] = { times: timesString.split(",").map(t => t.trim()), days: daysString ? daysString.split(",").map(Number) : null };
            saveData(data);
            return interaction.reply(`✅ Event **${name}** added.`);
        }

        if (command === "edit-event") {
            const name = interaction.options.getString("name");
            const timesString = interaction.options.getString("times");
            const daysString = interaction.options.getString("days");
            if (!data.events[name]) return interaction.reply({ content: `❌ Event **${name}** doesn't exist.`, flags: MessageFlags.Ephemeral });
            data.events[name].times = timesString.split(",").map(t => t.trim());
            data.events[name].days = daysString ? daysString.split(",").map(Number) : null;
            saveData(data);
            return interaction.reply(`✅ Event **${name}** updated.`);
        }

        if (command === "remove-event") {
            const name = interaction.options.getString("name");
            if (!data.events[name]) return interaction.reply({ content: `❌ Event **${name}** doesn't exist.`, flags: MessageFlags.Ephemeral });
            delete data.events[name];
            saveData(data);
            return interaction.reply(`🗑 Event **${name}** removed.`);
        }

    } catch (error) {
        console.error("Command Execution Error:", error);
        if (interaction.deferred) await interaction.editReply({ content: "❌ There was an error processing this command." }).catch(() => {});
        else if (!interaction.replied) await interaction.reply({ content: "❌ There was an error processing this command.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

/* =========================
   TTS CHAT LISTENER
========================= */

client.on("messageCreate", async message => {
    if (message.author.bot || !message.guild) return;
    const session = ttsSessions.get(message.guildId);
    if (!session) return;

    try {
        const url = googleTTS.getAudioUrl(message.content, { lang: "en", slow: false, host: "https://translate.google.com" });
        const resource = createAudioResource(url);
        session.queue.push(resource);
        if (session.player.state.status === AudioPlayerStatus.Idle) {
            const nextRes = session.queue.shift();
            if (nextRes) session.player.play(nextRes);
        }
    } catch (err) {}
});

/* =========================
   CRON EVENT SCHEDULER
========================= */

cron.schedule(
    "* * * * *",
    async () => {
        try {
            data = loadData();
            if (!data.events || Object.keys(data.events).length === 0) return;

            const ist = getISTTime();
            const guild = client.guilds.cache.get(GUILD_ID) || await client.guilds.fetch(GUILD_ID).catch(() => null);
            if (!guild) return;

            const channel = guild.channels.cache.get(EVENT_CHANNEL_ID) || await guild.channels.fetch(EVENT_CHANNEL_ID).catch(() => null);
            if (!channel || !channel.isTextBased()) return;

            const role = guild.roles.cache.find(r => r.name.trim().toLowerCase() === BADMASH_ROLE.trim().toLowerCase());
            const roleMention = role ? `${role}` : `@${BADMASH_ROLE}`;

            for (const [eventName, event] of Object.entries(data.events)) {
                const times = Array.isArray(event) ? event : event?.times;
                const days = Array.isArray(event) ? null : event?.days;
                if (!times || !Array.isArray(times)) continue;

                for (const eventTime of times) {
                    const eventMinutes = parseTimeToMinutes(eventTime);
                    if (eventMinutes === null) continue;

                    let difference = eventMinutes - ist.totalMinutes;
                    if (difference < 0) difference += 24 * 60;

                    if (days && Array.isArray(days) && days.length > 0) {
                        if (!days.includes(ist.currentDay)) continue;
                    }

                    if (difference === 15 || difference === 10 || difference === 0) {
                        let message = difference === 0 ? `🔔 **${eventName}** is starting now!\n\n${roleMention}\nGet ready!` : `⏰ **${eventName}** starts in **${difference} minutes!**\n\n${roleMention}\nGet ready!`;
                        await channel.send(message);
                    }
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

client.once("clientReady", async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    console.log(`🌏 Timezone: Asia/Kolkata`);
    console.log(`📅 Active Events Loaded: ${Object.keys(data.events).join(", ") || "None"}`);
    await registerCommands();
});

client.login(TOKEN);