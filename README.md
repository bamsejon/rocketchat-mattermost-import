<img src="icon.png" width="64" height="64" align="left" style="margin-right: 16px">

# Mattermost Import for Rocket.Chat

A Rocket.Chat app that imports channel history from Mattermost with full threading support.

<br clear="left">

## Features

- Import complete channel history from Mattermost to Rocket.Chat
- **Threading support** - Replies are imported as proper thread replies
- **Incremental sync** - Only imports new messages on subsequent runs (no duplicates)
- **File attachments** - Files are downloaded and uploaded to Rocket.Chat
- **Two authentication modes** - User credentials or admin token
- **Permission control** - Restrict who can use the import command
- Preserves original timestamps and usernames
- Shows progress during import
- Skips system messages automatically

## Installation

### Quick Install (Recommended)

1. **Download** the latest `.zip` from [Releases](https://github.com/bamsejon/rocketchat-mattermost-import/releases/latest)

2. **Enable Apps in Rocket.Chat:**
   - Log in as administrator
   - Go to **Administration** (gear icon) → **Settings** → **General** → **Apps**
   - Set **Enable the App Framework** to `True`
   - Set **Enable development mode** to `True` (required for private apps)
   - Click **Save changes**

3. **Install the App:**
   - Go to **Administration** → **Apps** → **Private Apps**
   - Click **Upload App**
   - Select the downloaded `.zip` file
   - Click **Install**
   - When prompted, click **Agree** to accept permissions

4. **Configure the App:**
   - Go to **Administration** → **Apps** → **Mattermost Import** → **Settings**
   - Configure authentication mode and permissions (see Configuration below)

### Build from Source

```bash
# Clone the repository
git clone https://github.com/bamsejon/rocketchat-mattermost-import.git
cd rocketchat-mattermost-import

# Install dependencies
npm install

# Build the app
npm run build

# The zip file will be created in dist/
```

## Usage

### With User Credentials (default mode)

```
/importmattermost <channel-url> <username> <password>
```

Example:
```
/importmattermost https://mattermost.company.com/myteam/channels/general admin mypassword
```

### With Admin Token

```
/importmattermost <channel-url>
```

Example:
```
/importmattermost https://mattermost.company.com/myteam/channels/general
```

## Configuration

Go to **Administration** → **Apps** → **Mattermost Import** → **Settings**

### Authentication Mode

- **User enters credentials** (default) - Users provide their own Mattermost username and password
- **Use admin token** - A pre-configured admin token is used for all imports

### Admin Token Setup

If using admin token mode:

1. In Mattermost, go to **Profile** → **Security** → **Personal Access Tokens**
2. Create a new token with appropriate permissions
3. Copy the token to the app settings

### Permission Control

- **Allowed Roles** - Comma-separated list of roles (e.g., `admin, moderator`)
- **Allowed Users** - Comma-separated list of usernames

Default: Only `admin` role can use the command.

## Message Format

Imported messages appear with the format:

```
**DisplayName (username) — YYYY-MM-DD HH:MM**

Original message content
```

Threaded replies are automatically linked to their parent messages.

## Incremental Sync

The app tracks imported messages per room/channel combination:

- First import: All messages are imported
- Subsequent imports: Only new messages since the last import
- Running the command again is safe - no duplicates will be created

## Requirements

- Rocket.Chat 6.0 or newer
- Apps Framework enabled
- Administrator access for installation

## Troubleshooting

### App doesn't appear after upload
- Make sure **Enable development mode** is set to `True` in Settings → General → Apps
- Try refreshing the page after enabling

### Import fails with authentication error
- Verify your Mattermost credentials are correct
- Check that your user has access to the channel
- For admin token mode, ensure the token has proper permissions

### Threading not working
- Threading requires importing messages in chronological order
- If parent messages were imported in a previous run, replies may not be linked

## Mattermost Channel Redirect

After importing a channel, the app can automatically activate a redirect on the source Mattermost channel so users are pointed to the new Rocket.Chat channel. This requires the [RC Migrate](https://github.com/bamsejon/mattermost-plugin-rc-migrate) Mattermost plugin (v1.1.0+).

### Setup

1. Install the [RC Migrate plugin](https://github.com/bamsejon/mattermost-plugin-rc-migrate/releases/latest) in Mattermost
2. Configure an **API Secret** in the Mattermost plugin settings (System Console → Plugins → RC Migrate)
3. In Rocket.Chat, go to **Administration → Apps → Mattermost Import → Settings**
4. Enable **Mattermost Redirect** and enter the same API secret

When you run `/importmattermost`, the source channel will automatically be blocked with a redirect message after the import completes.

## Changelog

### v2.7.0
- **Automatic Mattermost redirect**: After import, optionally activate the RC Migrate plugin on the source channel to redirect users to Rocket.Chat
- New settings: Enable Mattermost Redirect, RC Migrate API Secret

### v2.6.1
- **Fix: Missing `server-setting.read` permission** — caused all imports to fail with 320 errors
- Added `server-setting.read` to app permissions for reading Site_Url
- Added optional "Rocket.Chat Site URL" setting as fallback if server settings can't be read
- Improved error handling: user mapping failures no longer crash the entire import

### v2.6.0
- **Email auto-matching**: Automatically matches Mattermost users to Rocket.Chat users by email address
- Three mapping modes: email auto-match (recommended), username match, or manual JSON mapping
- Requires RC admin credentials for email auto-matching (configured in app settings)
- Falls back to manual mapping or freetext for unmatched users

### v2.5.0
- User mapping: Mattermost users are matched to Rocket.Chat users via username
- Manual JSON mapping for non-matching usernames
- Matched users appear as the actual sender instead of freetext
- Unmatched users fall back to previous freetext behavior

### v2.4.0
- Fixed file upload - files are now properly uploaded to Rocket.Chat
- Use latin1 encoding for binary file downloads

### v2.3.0
- Fixed message header format for better markdown compatibility
- Improved parsing of imported content

### v2.2.0
- Added threading support - replies are now imported as thread replies
- Shows threaded reply count in import summary

### v2.1.0
- Fixed incremental import persistence
- Added persistence permission

### v2.0.0
- Added incremental sync (only imports new messages)
- Added admin token authentication mode
- Added permission control (roles and users)

### v1.0.0
- Initial release

## License

MIT

## Author

bamsejon - https://github.com/bamsejon
