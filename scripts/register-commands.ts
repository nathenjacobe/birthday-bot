const APPLICATION_ID = process.env.APPLICATION_ID;
const TOKEN = process.env.DISCORD_TOKEN!;

if (!TOKEN) {
	throw new Error('DISCORD_TOKEN is not set');
}

const commands = [
	{
		name: 'set_birthday',
		description: 'set a birthday for a server member',
		options: [
			{
				name: 'member',
				description: "the member whose birthday you're setting",
				type: 6,
				required: true,
			},
			{
				name: 'day',
				description: 'birth day (1–31)',
				type: 4,
				required: true,
				min_value: 1,
				max_value: 31,
			},
			{
				name: 'month',
				description: 'birth month: number or name',
				type: 3,
				required: true,
			},
		],
	},

	{
		name: 'remove_birthday',
		description: "remove a member's birthday",
		options: [
			{
				name: 'member',
				description: 'the member whose birthday to remove',
				type: 6,
				required: true,
			},
		],
	},

	{
		name: 'list_birthdays',
		description: 'list all saved birthdays',
	},

	{
		name: 'next_birthday',
		description: 'show whose birthday is coming up next',
	},

	{
		name: 'set_channel',
		description: 'set the channel where birthday messages are sent',
		options: [
			{
				name: 'channel',
				description: 'the text channel to use',
				type: 7,
				required: true,
				channel_types: [0],
			},
		],
	},

	{
		name: 'debug_data',
		description: 'show raw contents of the birthday data',
	},
];

async function main() {
	const response = await fetch(`https://discord.com/api/v10/applications/${APPLICATION_ID}/commands`, {
		method: 'PUT',
		headers: {
			Authorization: `Bot ${TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(commands),
	});

	const text = await response.text();

	console.log(`discord responded with ${response.status}:`);
	console.log(text);

	if (!response.ok) {
		process.exit(1);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
