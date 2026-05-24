import discord
from discord import app_commands
from discord.ext import tasks
import json, os
from datetime import datetime
import zoneinfo

TOKEN = os.environ["DISCORD_TOKEN"]
DATA_PATH = os.environ.get("DATA_PATH", "/data/birthdays.json")
UK_TZ = zoneinfo.ZoneInfo("Europe/London")

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

    today = f"{now.month:02d}-{now.day:02d}"   # "MM-DD"
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
    month="birth month (1–12)",
    day="birth day (1–31)",
)
async def set_birthday(interaction: discord.Interaction, member: discord.Member, month: int, day: int):
    if not (1 <= month <= 12 and 1 <= day <= 31):
        await interaction.response.send_message("invalid date...", ephemeral=True)
        return

    data = load_data()
    data["birthdays"][str(member.id)] = f"{month:02d}-{day:02d}"
    save_data(data)
    await interaction.response.send_message(
        f"birthday set for {member.mention}: {day:02d}/{month:02d}", ephemeral=True
    )

@tree.command(name="remove_birthday", description="remove a member's birthday")
@app_commands.describe(member="the member whose birthday you want to remove")
async def remove_birthday(interaction: discord.Interaction, member: discord.Member):
    data = load_data()
    uid  = str(member.id)
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
        month, day = bday.split("-")
        lines.append(f"<@{user_id}>: {day}/{month}")

    await interaction.response.send_message("🎂 **birthdays**\n" + "\n".join(lines), ephemeral=True)

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
