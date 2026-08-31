CREATE TABLE settings (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
);

CREATE TABLE birthdays (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    month INTEGER NOT NULL,
    day INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE INDEX birthdays_date_idx
ON birthdays (month, day);
