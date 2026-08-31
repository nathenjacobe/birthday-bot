interface Env {
	DB: D1Database;
	DISCORD_TOKEN: string;
	DISCORD_PUBLIC_KEY: string;
}

const DISCORD_API = 'https://discord.com/api/v10';

const MONTH_NAMES: Record<number, string> = {
	1: 'January',
	2: 'February',
	3: 'March',
	4: 'April',
	5: 'May',
	6: 'June',
	7: 'July',
	8: 'August',
	9: 'September',
	10: 'October',
	11: 'November',
	12: 'December',
};

const MONTH_LOOKUP: Record<string, number> = {};

for (const [num, name] of Object.entries(MONTH_NAMES)) {
	MONTH_LOOKUP[name.toLowerCase()] = Number(num);
	MONTH_LOOKUP[name.toLowerCase().slice(0, 3)] = Number(num);
}

function parseMonth(value: string): number | null {
	const trimmed = value.trim();

	if (/^\d+$/.test(trimmed)) {
		const month = Number(trimmed);
		return month >= 1 && month <= 12 ? month : null;
	}

	return MONTH_LOOKUP[trimmed.toLowerCase()] ?? null;
}

function ordinal(n: number): string {
	if (n % 100 >= 11 && n % 100 <= 13) {
		return `${n}th`;
	}

	const suffix = ['th', 'st', 'nd', 'rd', 'th'][Math.min(n % 10, 4)];
	return `${n}${suffix}`;
}

function humanDate(month: number, day: number): string {
	return `${MONTH_NAMES[month]} ${ordinal(day)}`;
}

function response(content: string, ephemeral = false): Response {
	return Response.json({
		type: 4,
		data: {
			content,
			...(ephemeral ? { flags: 64 } : {}),
		},
	});
}

function getOption(options: any[] | undefined, name: string): any | undefined {
	return options?.find((option) => option.name === name);
}

async function verifyDiscordRequest(request: Request, publicKeyHex: string): Promise<{ valid: boolean; body: string }> {
	const signature = request.headers.get('X-Signature-Ed25519');
	const timestamp = request.headers.get('X-Signature-Timestamp');
	const body = await request.text();

	if (!signature || !timestamp) {
		return { valid: false, body };
	}

	const publicKey = hexToBytes(publicKeyHex);
	const sig = hexToBytes(signature);
	const message = new TextEncoder().encode(timestamp + body);

	const key = await crypto.subtle.importKey(
		'raw',
		publicKey,
		{
			name: 'Ed25519',
		},
		false,
		['verify'],
	);

	const valid = await crypto.subtle.verify('Ed25519', key, sig, message);

	return { valid, body };
}

function hexToBytes(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);

	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}

	return bytes;
}

function londonNow() {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/London',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(new Date());

	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);

	return {
		year: get('year'),
		month: get('month'),
		day: get('day'),
		hour: get('hour'),
		minute: get('minute'),
	};
}

async function sendDiscordMessage(token: string, channelId: string, content: string): Promise<Response> {
	return fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
		method: 'POST',
		headers: {
			Authorization: `Bot ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			content,
			allowed_mentions: {
				parse: ['everyone', 'users'],
			},
		}),
	});
}

async function handleInteraction(interaction: any, env: Env): Promise<Response> {
	if (interaction.type === 1) {
		return Response.json({ type: 1 });
	}

	if (interaction.type !== 2) {
		return response('unsupported interaction', true);
	}

	const command = interaction.data;
	const commandName = command.name;
	const guildId = interaction.guild_id;

	if (!guildId) {
		return response('this bot only works inside a server.', true);
	}

	const options = command.options ?? [];

	if (commandName === 'set_birthday') {
		const memberOption = getOption(options, 'member');
		const dayOption = getOption(options, 'day');
		const monthOption = getOption(options, 'month');

		const userId = memberOption?.value;
		const day = Number(dayOption?.value);
		const month = parseMonth(String(monthOption?.value ?? ''));

		if (!userId || month === null || !Number.isInteger(day) || day < 1 || day > 31) {
			return response('invalid date; use a day (1–31) and a month number or name.', true);
		}

		await env.DB.prepare(
			`INSERT INTO birthdays (guild_id, user_id, month, day)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(guild_id, user_id)
       DO UPDATE SET month = excluded.month, day = excluded.day`,
		)
			.bind(guildId, userId, month, day)
			.run();

		return response(`birthday set for <@${userId}>: ${humanDate(month, day)}`, true);
	}

	if (commandName === 'remove_birthday') {
		const memberOption = getOption(options, 'member');
		const userId = memberOption?.value;

		if (!userId) {
			return response('invalid member.', true);
		}

		const result = await env.DB.prepare(
			`DELETE FROM birthdays
       WHERE guild_id = ? AND user_id = ?`,
		)
			.bind(guildId, userId)
			.run();

		if (result.meta.changes === 0) {
			return response(`no birthday set for <@${userId}>.`, true);
		}

		return response(`successfully removed birthday for <@${userId}>`, true);
	}

	if (commandName === 'list_birthdays') {
		const result = await env.DB.prepare(
			`SELECT user_id, month, day
       FROM birthdays
       WHERE guild_id = ?
       ORDER BY month, day`,
		)
			.bind(guildId)
			.all();

		if (result.results.length === 0) {
			return response('no birthdays saved yet', true);
		}

		const lines = result.results.map((row: any) => `<@${row.user_id}>: ${humanDate(row.month, row.day)}`);

		return response(`**birthdays**\n${lines.join('\n')}`, true);
	}

	if (commandName === 'next_birthday') {
		const result = await env.DB.prepare(
			`SELECT user_id, month, day
       FROM birthdays
       WHERE guild_id = ?`,
		)
			.bind(guildId)
			.all();

		if (result.results.length === 0) {
			return response('no birthdays saved yet', true);
		}

		const now = londonNow();

		function daysUntil(month: number, day: number): number {
			const today = new Date(Date.UTC(now.year, now.month - 1, now.day));

			let candidate = new Date(Date.UTC(now.year, month - 1, day));

			if (candidate < today) {
				candidate = new Date(Date.UTC(now.year + 1, month - 1, day));
			}

			return Math.floor((candidate.getTime() - today.getTime()) / 86400000);
		}

		const sorted = [...result.results].sort((a: any, b: any) => daysUntil(a.month, a.day) - daysUntil(b.month, b.day));

		// FIXME: need to correctly type next struct to silence next.month as unknown
		const next = sorted[0];
		const days = daysUntil(next.month, next.day);

		const sameDay = sorted.filter((row: any) => daysUntil(row.month, row.day) === days);

		const names = sameDay.map((row: any) => `<@${row.user_id}>`).join(', ');

		let message: string;

		if (days === 0) {
			message = `it's ${names}'s birthday **today**!`;
		} else if (days === 1) {
			message = `${names}'s birthday is **tomorrow** (${humanDate(next.month, next.day)})!`;
		} else {
			message = `the next birthday is ${names}'s on **${humanDate(next.month, next.day)}**, in ${days} days!`;
		}

		return response(message, true);
	}

	if (commandName === 'set_channel') {
		const channelOption = getOption(options, 'channel');
		const channelId = channelOption?.value;

		if (!channelId) {
			return response('invalid channel.', true);
		}

		await env.DB.prepare(
			`INSERT INTO settings (guild_id, channel_id)
       VALUES (?, ?)
       ON CONFLICT(guild_id)
       DO UPDATE SET channel_id = excluded.channel_id`,
		)
			.bind(guildId, channelId)
			.run();

		return response(`birthday channel set to <#${channelId}>`, true);
	}

	if (commandName === 'debug_data') {
		const settings = await env.DB.prepare(`SELECT channel_id FROM settings WHERE guild_id = ?`).bind(guildId).first();

		const birthdays = await env.DB.prepare(
			`SELECT user_id, month, day
       FROM birthdays
       WHERE guild_id = ?
       ORDER BY month, day`,
		)
			.bind(guildId)
			.all();

		const data = {
			channel_id: settings?.channel_id ?? null,
			birthdays: Object.fromEntries(
				birthdays.results.map((row: any) => [row.user_id, `${String(row.month).padStart(2, '0')}-${String(row.day).padStart(2, '0')}`]),
			),
		};

		return response(`\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``, true);
	}

	return response('unknown command', true);
}

async function runBirthdayCheck(env: Env) {
	const now = londonNow();

	if (now.hour !== 0) {
		return;
	}

	const settings = await env.DB.prepare(`SELECT guild_id, channel_id FROM settings`).all();

	for (const setting of settings.results as any[]) {
		const birthdays = await env.DB.prepare(
			`SELECT user_id
       FROM birthdays
       WHERE guild_id = ?
         AND month = ?
         AND day = ?`,
		)
			.bind(setting.guild_id, now.month, now.day)
			.all();

		for (const birthday of birthdays.results as any[]) {
			try {
				await sendDiscordMessage(env.DISCORD_TOKEN, setting.channel_id, `happy birthday, <@${birthday.user_id}>! @everyone`);
			} catch (error) {
				console.error(`error sending birthday message:`, error);
			}
		}
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname !== '/interactions') {
			return new Response('not found', {
				status: 404,
			});
		}

		if (request.method !== 'POST') {
			return new Response('method not allowed', {
				status: 405,
			});
		}

		const verification = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);

		if (!verification.valid) {
			return new Response('invalid request signature', {
				status: 401,
			});
		}

		const interaction = JSON.parse(verification.body);

		return handleInteraction(interaction, env);
	},

	async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
		await runBirthdayCheck(env);
	},
};
