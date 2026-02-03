# Mattermost Import for Rocket.Chat

A Rocket.Chat app that imports channel history from Mattermost using a simple slash command.

## Features

- Import complete channel history from Mattermost to Rocket.Chat
- Preserves original timestamps and usernames
- Shows progress during import
- Handles file attachments (as links)
- Skips system messages automatically

## Installation

1. Download the latest release (`mattermost-import_x.x.x.zip`)
2. Go to **Administration** → **Marketplace** → **Private Apps**
3. Click **Upload App** and select the zip file
4. Approve the requested permissions

## Usage

In any Rocket.Chat channel, use the `/import` command:

```
/import mattermost <url> <username> <password> <team/channel>
```

### Parameters

- `url` - Your Mattermost server URL (e.g., `https://mattermost.example.com`)
- `username` - Mattermost username
- `password` - Mattermost password
- `team/channel` - Path to the channel in format `teamname/channelname`

### Example

```
/import mattermost https://mattermost.company.com admin mypassword engineering/general
```

## Message Format

Imported messages appear with the format:

```
[DisplayName (username) YYYY-MM-DD HH:MM]
Original message content
```

## Permissions Required

- **slashcommand** - Register the `/import` command
- **networking** - Connect to Mattermost API
- **message.write** - Post imported messages
- **upload.write** - Handle file attachments

## Compatibility

- Rocket.Chat Apps Engine: ^1.41.0
- Mattermost: v10.x (tested with 10.12.4)

## License

MIT
