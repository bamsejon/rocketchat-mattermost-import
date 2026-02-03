# Mattermost Import for Rocket.Chat

A Rocket.Chat app that imports channel history from Mattermost using a simple slash command.

## Features

- Import complete channel history from Mattermost to Rocket.Chat
- **Incremental sync** - Only imports new messages on subsequent runs (no duplicates)
- **Two authentication modes** - User credentials or admin token
- **Permission control** - Restrict who can use the import command
- Preserves original timestamps and usernames
- Shows progress during import
- Handles file attachments (as links)
- Skips system messages automatically

## Installation

1. Download the latest release (`mattermost-import_x.x.x.zip`)
2. Go to **Administration** → **Marketplace** → **Private Apps**
3. Click **Upload App** and select the zip file
4. Approve the requested permissions
5. Configure the app settings (see Configuration below)

## Configuration

Go to **Administration** → **Apps** → **Mattermost Import** → **Settings**

### Authentication Mode

Choose how users authenticate with Mattermost:

- **User enters credentials** (default) - Users provide their own Mattermost username and password
- **Use admin token** - A pre-configured admin token is used for all imports

### Admin Token Setup (optional)

If using admin token mode:

1. In Mattermost, go to **Profile** → **Security** → **Personal Access Tokens**
2. Create a new token with appropriate permissions
3. Copy the token to the app settings

### Permission Control

- **Allowed Roles** - Comma-separated list of roles (e.g., `admin, moderator`)
- **Allowed Users** - Comma-separated list of usernames (in addition to roles)

Default: Only `admin` role can use the command.

## Usage

### With User Credentials (default mode)

```
/importmattermost <channel-url> <username> <password>
```

Example:
```
/importmattermost https://mattermost.company.com/engineering/channels/general admin mypassword
```

### With Admin Token

```
/importmattermost <channel-url>
```

Example:
```
/importmattermost https://mattermost.company.com/engineering/channels/general
```

## Incremental Sync

The app tracks which messages have been imported per room/channel combination:

- First import: All messages are imported
- Subsequent imports: Only new messages since the last import are fetched
- Running the command again is safe - no duplicates will be created
- Import history is stored per Rocket.Chat room

## Message Format

Imported messages appear with the format:

```
[DisplayName (username) YYYY-MM-DD HH:MM]
Original message content
```

## Permissions Required

- **slashcommand** - Register the `/importmattermost` command
- **networking** - Connect to Mattermost API
- **message.write** - Post imported messages
- **upload.write** - Handle file attachments

## Compatibility

- Rocket.Chat Apps Engine: ^1.41.0
- Mattermost: v10.x (tested with 10.12.4)

## Changelog

### v2.0.0
- Added incremental sync (only imports new messages)
- Added admin token authentication mode
- Added permission control (roles and users)
- Added app settings for configuration

### v1.2.0
- Changed command from `/import mattermost` to `/importmattermost`

### v1.1.0
- Simplified URL input (paste full channel URL)

### v1.0.0
- Initial release

## License

MIT
