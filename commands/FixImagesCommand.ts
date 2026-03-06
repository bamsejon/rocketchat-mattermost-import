import {
    IHttp,
    IModify,
    IRead,
    IPersistence,
} from '@rocket.chat/apps-engine/definition/accessors';
import {
    ISlashCommand,
    SlashCommandContext,
} from '@rocket.chat/apps-engine/definition/slashcommands';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { IRoom } from '@rocket.chat/apps-engine/definition/rooms';
import { App } from '@rocket.chat/apps-engine/definition/App';

/**
 * Post-import image fixer: Scans already-imported messages for Mattermost file
 * links and re-uploads them to Rocket.Chat. Run this after a normal import
 * to make images self-hosted.
 *
 * Usage: /fixmmimages [mattermost-url]
 *
 * If mattermost-url is not provided, it tries to detect URLs from message content.
 * Uses the admin_token from app settings for Mattermost authentication.
 */
export class FixImagesCommand implements ISlashCommand {
    public command = 'fixmmimages';
    public i18nParamsExample = 'fixmm_params_example';
    public i18nDescription = 'fixmm_description';
    public providesPreview = false;

    constructor(private readonly app: App) {}

    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persistence: IPersistence
    ): Promise<void> {
        const args = context.getArguments();
        const sender = context.getSender();
        const room = context.getRoom();

        // Check permissions (reuse same settings as import)
        const hasPermission = await this.checkPermission(sender, read);
        if (!hasPermission) {
            await this.notify(room, sender, modify,
                '**Error:** You do not have permission to use this command.');
            return;
        }

        // Get Mattermost token from settings
        const adminToken = await read.getEnvironmentReader().getSettings().getValueById('admin_token') as string;
        if (!adminToken) {
            await this.notify(room, sender, modify,
                '**Error:** No Mattermost admin token configured in app settings.');
            return;
        }

        // Optional: explicit Mattermost URL from args or settings
        let mattermostUrl = args.length > 0 ? args[0] : '';
        if (!mattermostUrl) {
            mattermostUrl = await read.getEnvironmentReader().getSettings().getValueById('mattermost_url') as string || '';
        }

        await this.notify(room, sender, modify,
            '🔍 Scanning messages in this channel for Mattermost file links...');

        try {
            // Get RC admin credentials for reading messages via REST API
            const settings = read.getEnvironmentReader().getSettings();
            const rcAdminUserId = await settings.getValueById('rc_admin_user_id') as string;
            const rcAdminToken = await settings.getValueById('rc_admin_token') as string;

            if (!rcAdminUserId || !rcAdminToken) {
                await this.notify(room, sender, modify,
                    '**Error:** RC admin credentials not configured. Need `rc_admin_user_id` and `rc_admin_token` in app settings.');
                return;
            }

            let siteUrl = await settings.getValueById('rc_site_url') as string;
            if (!siteUrl) {
                try {
                    siteUrl = await read.getEnvironmentReader().getServerSettings().getValueById('Site_Url') as string;
                } catch (e) {
                    // ignore
                }
            }
            if (!siteUrl) {
                await this.notify(room, sender, modify,
                    '**Error:** Could not determine Rocket.Chat site URL.');
                return;
            }

            // Fetch all messages in room via REST API (paginated)
            const messages = await this.fetchRoomMessages(http, siteUrl, rcAdminUserId, rcAdminToken, room);

            if (messages.length === 0) {
                await this.notify(room, sender, modify, 'No messages found in this channel.');
                return;
            }

            // Regex to find Mattermost file links in message text
            // Matches: [filename](https://mm.example.com/api/v4/files/FILEID)
            // Also matches raw URLs: https://mm.example.com/api/v4/files/FILEID
            const fileUrlRegex = /(?:\[([^\]]*)\]\()?(https?:\/\/[^\s\)]+\/api\/v4\/files\/([a-z0-9]{26}))(?:\))?/gi;

            let totalFound = 0;
            let totalFixed = 0;
            let totalFailed = 0;
            const processedMessages: Array<{msgId: string, oldText: string, newText: string, files: string[]}> = [];

            for (const msg of messages) {
                const text = msg.msg || '';
                const matches = [...text.matchAll(fileUrlRegex)];

                if (matches.length === 0) continue;

                totalFound += matches.length;
                let newText = text;
                const uploadedFiles: string[] = [];

                for (const match of matches) {
                    const linkText = match[1] || '';
                    const fullUrl = match[2];
                    const fileId = match[3];

                    // Extract Mattermost base URL from the file URL
                    const mmBaseUrl = mattermostUrl || fullUrl.replace(/\/api\/v4\/files\/.*$/, '');

                    try {
                        // Get file info
                        const fileInfo = await this.getFileInfo(http, mmBaseUrl, adminToken, fileId);
                        if (!fileInfo) {
                            this.app.getLogger().warn(`Could not get file info for ${fileId}`);
                            totalFailed++;
                            continue;
                        }

                        // Download from Mattermost
                        const fileContent = await this.downloadFile(http, mmBaseUrl, adminToken, fileId);
                        if (!fileContent) {
                            this.app.getLogger().warn(`Could not download file ${fileId}`);
                            totalFailed++;
                            continue;
                        }

                        // Upload to Rocket.Chat via REST API
                        const rcFileUrl = await this.uploadToRocketChat(
                            http, siteUrl, rcAdminUserId, rcAdminToken,
                            room.id, fileContent, fileInfo.name, fileInfo.mime_type,
                            msg._id
                        );

                        if (rcFileUrl) {
                            // Replace the Mattermost link with RC file reference
                            const fileName = linkText || fileInfo.name;
                            // For images, use inline image syntax
                            if (fileInfo.mime_type && fileInfo.mime_type.startsWith('image/')) {
                                newText = newText.replace(match[0], `![${fileName}](${rcFileUrl})`);
                            } else {
                                newText = newText.replace(match[0], `[${fileName}](${rcFileUrl})`);
                            }
                            uploadedFiles.push(fileInfo.name);
                            totalFixed++;
                        } else {
                            totalFailed++;
                        }
                    } catch (error) {
                        this.app.getLogger().error(`Failed to fix file ${fileId}:`, error);
                        totalFailed++;
                    }

                    // Small delay to avoid rate limiting
                    await this.sleep(200);
                }

                if (uploadedFiles.length > 0) {
                    processedMessages.push({
                        msgId: msg._id,
                        oldText: text,
                        newText: newText,
                        files: uploadedFiles,
                    });
                }
            }

            // Update messages with new file links
            let updateErrors = 0;
            for (const pm of processedMessages) {
                try {
                    await this.updateMessage(http, siteUrl, rcAdminUserId, rcAdminToken, pm.msgId, pm.newText);
                } catch (error) {
                    this.app.getLogger().error(`Failed to update message ${pm.msgId}:`, error);
                    updateErrors++;
                }
                await this.sleep(100);
            }

            // Progress report every 50 files
            await this.notify(room, sender, modify,
                `**Image fix complete!**\n` +
                `- Messages scanned: ${messages.length}\n` +
                `- Mattermost file links found: ${totalFound}\n` +
                `- Successfully re-uploaded: ${totalFixed}\n` +
                `- Failed: ${totalFailed}\n` +
                `- Messages updated: ${processedMessages.length - updateErrors}\n` +
                `- Update errors: ${updateErrors}`
            );

        } catch (error) {
            this.app.getLogger().error('Fix images failed:', error);
            await this.notify(room, sender, modify,
                `**Error:** ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async fetchRoomMessages(
        http: IHttp,
        siteUrl: string,
        userId: string,
        token: string,
        room: IRoom
    ): Promise<any[]> {
        const allMessages: any[] = [];
        let offset = 0;
        const count = 100;

        // Determine API endpoint based on room type
        const endpoint = room.type === 'p' ? 'groups.history' : 'channels.history';

        while (true) {
            const response = await http.get(
                `${siteUrl}/api/v1/${endpoint}?roomId=${room.id}&count=${count}&offset=${offset}`,
                {
                    headers: {
                        'X-Auth-Token': token,
                        'X-User-Id': userId,
                    },
                }
            );

            if (response.statusCode !== 200 || !response.data) {
                this.app.getLogger().error(`Failed to fetch messages: ${response.statusCode}`);
                break;
            }

            const messages = response.data.messages || [];
            if (messages.length === 0) break;

            allMessages.push(...messages);

            if (messages.length < count) break;
            offset += count;
        }

        return allMessages;
    }

    private async getFileInfo(
        http: IHttp, baseUrl: string, token: string, fileId: string
    ): Promise<{name: string; mime_type: string; size: number} | null> {
        try {
            const response = await http.get(`${baseUrl}/api/v4/files/${fileId}/info`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (response.statusCode === 200 && response.data) {
                return response.data;
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    private async downloadFile(
        http: IHttp, baseUrl: string, token: string, fileId: string
    ): Promise<Buffer | null> {
        try {
            const response = await http.get(`${baseUrl}/api/v4/files/${fileId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (response.statusCode === 200 && response.content) {
                return Buffer.from(response.content, 'latin1');
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    private async uploadToRocketChat(
        http: IHttp,
        siteUrl: string,
        userId: string,
        token: string,
        roomId: string,
        fileContent: Buffer,
        fileName: string,
        mimeType: string,
        tmid?: string,
    ): Promise<string | null> {
        try {
            // Use RC REST API to upload file
            // We need to use multipart/form-data which is tricky via the Apps Engine HTTP
            // Instead, use the rooms.upload endpoint with base64 encoding

            const base64Content = fileContent.toString('base64');

            // Try using the REST API upload endpoint
            const response = await http.post(
                `${siteUrl}/api/v1/rooms.upload/${roomId}`,
                {
                    headers: {
                        'X-Auth-Token': token,
                        'X-User-Id': userId,
                        'Content-Type': 'application/json',
                    },
                    data: {
                        file: base64Content,
                        filename: fileName,
                        mimetype: mimeType,
                        description: 'Re-uploaded from Mattermost',
                        ...(tmid ? { tmid } : {}),
                    },
                }
            );

            if (response.statusCode === 200 && response.data) {
                // Extract the file URL from the upload response
                const message = response.data.message;
                if (message && message.file) {
                    return `${siteUrl}/file-upload/${message.file._id}/${encodeURIComponent(message.file.name)}`;
                }
                // Try attachments
                if (message && message.attachments && message.attachments.length > 0) {
                    return message.attachments[0].image_url || message.attachments[0].title_link || null;
                }
            }

            this.app.getLogger().error(`Upload failed: ${response.statusCode} ${JSON.stringify(response.data)}`);
            return null;
        } catch (error) {
            this.app.getLogger().error(`Upload error for ${fileName}:`, error);
            return null;
        }
    }

    private async updateMessage(
        http: IHttp,
        siteUrl: string,
        userId: string,
        token: string,
        msgId: string,
        newText: string,
    ): Promise<void> {
        const response = await http.post(
            `${siteUrl}/api/v1/chat.update`,
            {
                headers: {
                    'X-Auth-Token': token,
                    'X-User-Id': userId,
                    'Content-Type': 'application/json',
                },
                data: {
                    roomId: '', // Not needed with msgId
                    msgId: msgId,
                    text: newText,
                },
            }
        );

        if (response.statusCode !== 200) {
            throw new Error(`chat.update failed: ${response.statusCode}`);
        }
    }

    private async checkPermission(user: IUser, read: IRead): Promise<boolean> {
        const settings = read.getEnvironmentReader().getSettings();
        const allowedRolesStr = await settings.getValueById('allowed_roles') as string;
        const allowedRoles = allowedRolesStr.split(',').map(r => r.trim().toLowerCase()).filter(r => r);
        const allowedUsersStr = await settings.getValueById('allowed_users') as string;
        const allowedUsers = allowedUsersStr ? allowedUsersStr.split(',').map(u => u.trim().toLowerCase()).filter(u => u) : [];

        if (allowedUsers.length > 0 && allowedUsers.includes(user.username.toLowerCase())) return true;
        if (user.roles && allowedRoles.length > 0) {
            for (const role of user.roles) {
                if (allowedRoles.includes(role.toLowerCase())) return true;
            }
        }
        return false;
    }

    private async notify(room: IRoom, sender: IUser, modify: IModify, text: string): Promise<void> {
        const notifier = modify.getNotifier();
        const messageBuilder = notifier.getMessageBuilder()
            .setRoom(room)
            .setSender(sender)
            .setText(text);
        await notifier.notifyUser(sender, messageBuilder.getMessage());
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
