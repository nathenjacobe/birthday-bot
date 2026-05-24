import discord
from discord import app_commands
from discord.ext import tasks
import json, os
from datetime import datetime
import zoneinfo

TOKEN = os.environ["DISCORD_TOKEN"]
DATA_PATH = os.environ.get("DATA_PATH", "/data/birthdays.json")
UK_TZ = zoneinfo.ZoneInfo("Europe/London")

MONTH_NAMES = {
    1: "January", 2: "February", 3: "March", 4: "April",
    5: "May", 6: "June", 7: "July", 8: "August",
    9: "September", 10: "October", 11: "November", 12: "December"
}

MONTH_LOOKUP = {name.lower(): num for num, name in MONTH_NAMES.items()}
MONTH_LOOKUP.update({name.lower()[:3]: num for num, name in MONTH_NAMES.items()})

def parse_month(value: str) -> int | None:
    value = value.strip()
    if value.isdigit():
        m = int(value)
        return m if 1 <= m <= 12 else None
    return MONTH_LOOKUP.get(value.lower())

def ordinal(n: int) -> str:
    if 11 <= n % 100 <= 13:
        return f"{n}th"
    return f"{n}{['th','st','nd','rd','th'][min(n % 10, 4)]}"

def human_date(bday: str) -> str:
    month, day = map(int, bday.split("-"))
    return f"{MONTH_NAMES[month]} {ordinal(day)}"

def load_data() -> dict:
    if not os.path.exists(DATA_PATH):
        return {"channel_id": None, "birthdays": {}}
    with open(DATA_PATH) as f:
        return json.load(f)

def save_data(data: dict):
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w") as f:
        json.dump(data, f, indent=2)

intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)

@client.event
async def on_ready():
    await tree.sync()
    print(f"logged in as {client.user}, commands synced.")
    birthday_check.start()

@tasks.loop(hours=1)
async def birthday_check():
    now = datetime.now(UK_TZ)
    if now.hour != 0:
        return

    data = load_data()
    channel_id = data.get("channel_id")
    if not channel_id:
        return

    channel = client.get_channel(int(channel_id))
    if not channel:
        return

    today = f"{now.month:02d}-{now.day:02d}"
    for user_id, birthday in data["birthdays"].items():
        if birthday == today:
            try:
                member = channel.guild.get_member(int(user_id))
                name = member.mention if member else f"<@{user_id}>"
                await channel.send(f"🎂 happy birthday, {name}! @everyone")
            except Exception as e:
                print(f"error sending birthday message: {e}")

@birthday_check.before_loop
async def before_birthday_check():
    await client.wait_until_ready()

@tree.command(name="set_birthday", description="set a birthday for a server member")
@app_commands.describe(
    member="the member whose birthday you're setting",
    day="birth day (1–31)",
    month="birth month: number (1–12) or name (e.g. August, august, aug)",
)
async def set_birthday(interaction: discord.Interaction, member: discord.Member, day: int, month: str):
    month_num = parse_month(month)
    if month_num is None or not (1 <= day <= 31):
        await interaction.response.send_message(
            "invalid date; use a day (1–31) and a month number or name (e.g. `8` or `August` or `aug`)",
            ephemeral=True
        )
        return

    data = load_data()
    data["birthdays"][str(member.id)] = f"{month_num:02d}-{day:02d}"
    save_data(data)
    await interaction.response.send_message(
        f"birthday set for {member.mention}: {human_date(f'{month_num:02d}-{day:02d}')}",
        ephemeral=True
    )

@tree.command(name="remove_birthday", description="remove a member's birthday")
@app_commands.describe(member="the member whose birthday you want to remove")
async def remove_birthday(interaction: discord.Interaction, member: discord.Member):
    data = load_data()
    uid = str(member.id)
    if uid not in data["birthdays"]:
        await interaction.response.send_message(f"no birthday set for {member.mention}.", ephemeral=True)
        return

    del data["birthdays"][uid]
    save_data(data)
    await interaction.response.send_message(f"successfully removed birthday for {member.mention}", ephemeral=True)

@tree.command(name="list_birthdays", description="list all saved birthdays")
async def list_birthdays(interaction: discord.Interaction):
    data = load_data()
    birthdays = data.get("birthdays", {})
    if not birthdays:
        await interaction.response.send_message("no birthdays saved yet", ephemeral=True)
        return

    lines = []
    for user_id, bday in sorted(birthdays.items(), key=lambda x: x[1]):
        lines.append(f"<@{user_id}>: {human_date(bday)}")

    await interaction.response.send_message("🎂 **birthdays**\n" + "\n".join(lines), ephemeral=True)

@tree.command(name="next_birthday", description="show whose birthday is coming up next")
async def next_birthday(interaction: discord.Interaction):
    data = load_data()
    birthdays = data.get("birthdays", {})
    if not birthdays:
        await interaction.response.send_message("no birthdays saved yet", ephemeral=True)
        return

    now = datetime.now(UK_TZ)
    today_md = (now.month, now.day)

    def days_until(bday: str) -> int:
        month, day = map(int, bday.split("-"))
        candidate = datetime(now.year, month, day, tzinfo=UK_TZ)
        if (month, day) < today_md:
            candidate = datetime(now.year + 1, month, day, tzinfo=UK_TZ)
        return (candidate - now.replace(hour=0, minute=0, second=0, microsecond=0)).days

    sorted_bdays = sorted(birthdays.items(), key=lambda x: days_until(x[1]))
    next_uid, next_bday = sorted_bdays[0]
    days = days_until(next_bday)

    # collect everyone sharing the same birthday
    same_day = [(uid, bday) for uid, bday in sorted_bdays if days_until(bday) == days]
    names = ", ".join(f"<@{uid}>" for uid, _ in same_day)

    if days == 0:
        msg = f"🎂 it's {names}'s birthday **today**!"
    elif days == 1:
        msg = f"🎂 {names}'s birthday is **tomorrow** ({human_date(next_bday)})!"
    else:
        msg = f"🎂 the next birthday is {names}'s on **{human_date(next_bday)}**, in {days} days!"

    await interaction.response.send_message(msg, ephemeral=True)

@tree.command(name="set_channel", description="set the channel where birthday messages are sent")
@app_commands.describe(channel="the text channel to use")
async def set_channel(interaction: discord.Interaction, channel: discord.TextChannel):
    data = load_data()
    data["channel_id"] = str(channel.id)
    save_data(data)
    await interaction.response.send_message(f"birthday channel set to {channel.mention}", ephemeral=True)

@tree.command(name="debug_data", description="show raw contents of the data json")
async def debug_data(interaction: discord.Interaction):
    if not os.path.exists(DATA_PATH):
        await interaction.response.send_message("data file does not exist yet", ephemeral=True)
        return
    with open(DATA_PATH) as f:
        contents = f.read()
    await interaction.response.send_message(f"```json\n{contents}\n```", ephemeral=True)

client.run(TOKEN)
