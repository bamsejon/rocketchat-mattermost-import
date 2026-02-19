import {
    IHttp,
    IModify,
    IRead,
    IPersistence,
    IPersistenceRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import {
    ISlashCommand,
    SlashCommandContext,
} from '@rocket.chat/apps-engine/definition/slashcommands';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { IRoom } from '@rocket.chat/apps-engine/definition/rooms';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

interface MattermostPost {
    id: string;
    create_at: number;
    update_at: number;
    user_id: string;
    channel_id: string;
    root_id: string;
    message: string;
    type: string;
    file_ids?: string[];
    metadata?: {
        files?: Array<{
            id: string;
            name: string;
            extension: string;
            size: number;
            mime_type: string;
        }>;
    };
}

interface MattermostUser {
    id: string;
    username: string;
    first_name: string;
    last_name: string;
    nickname: string;
    email: string;
}

interface MattermostFile {
    id: string;
    name: string;
    extension: string;
    size: number;
    mime_type: string;
}

interface ImportRecord {
    roomId: string;
    mattermostChannelId: string;
    mattermostUrl: string;
    teamName: string;
    channelName: string;
    lastImportedTimestamp: number;
    lastImportedPostId: string;
    totalImported: number;
    lastImportDate: string;
}

export class ImportCommand implements ISlashCommand {
    public command = 'importmattermost';
    public i18nParamsExample = 'import_params_example';
    public i18nDescription = 'import_description';
    public providesPreview = false;

    private userCache: Map<string, MattermostUser> = new Map();
    private rcUserCache: Map<string, IUser | null> = new Map();

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

        // Check permissions first
        const hasPermission = await this.checkPermission(sender, read);
        if (!hasPermission) {
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                '**Error:** You do not have permission to use this command.\n\n' +
                'Contact your administrator to get access.'
            );
            return;
        }

        // Get auth mode from settings
        const authMode = await read.getEnvironmentReader().getSettings().getValueById('auth_mode');

        let mattermostUrl: string;
        let token: string | null;
        let teamName: string;
        let channelName: string;

        if (authMode === 'admin_token') {
            // Admin token mode: /importmattermost <channel-url>
            if (args.length < 1) {
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    '**Usage:** `/importmattermost <channel-url>`\n\n' +
                    '**Example:** `/importmattermost https://mattermost.example.com/myteam/channels/general`\n\n' +
                    'Authentication is handled by admin token (configured in app settings).'
                );
                return;
            }

            const fullUrl = args[0];
            const urlMatch = fullUrl.match(/^(https?:\/\/[^\/]+)\/([^\/]+)\/channels\/([^\/]+)\/?$/);

            if (!urlMatch) {
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    '**Error:** Invalid Mattermost URL format.\n\n' +
                    'Expected: `https://mattermost.example.com/team/channels/channel`'
                );
                return;
            }

            // Get configured URL and token
            const configuredUrl = await read.getEnvironmentReader().getSettings().getValueById('mattermost_url');
            const adminToken = await read.getEnvironmentReader().getSettings().getValueById('admin_token');

            if (!adminToken) {
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    '**Error:** Admin token not configured.\n\n' +
                    'Ask your administrator to configure the Mattermost admin token in app settings.'
                );
                return;
            }

            // Use URL from the command, but can be overridden by settings
            mattermostUrl = urlMatch[1];
            teamName = urlMatch[2];
            channelName = urlMatch[3];
            token = adminToken as string;

        } else {
            // User credentials mode: /importmattermost <channel-url> <username> <password>
            if (args.length < 3) {
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    '**Usage:** `/importmattermost <channel-url> <username> <password>`\n\n' +
                    '**Example:** `/importmattermost https://mattermost.example.com/myteam/channels/general user pass`\n\n' +
                    'Just paste the full URL from your Mattermost channel!'
                );
                return;
            }

            const fullUrl = args[0];
            const username = args[1];
            const password = args[2];

            const urlMatch = fullUrl.match(/^(https?:\/\/[^\/]+)\/([^\/]+)\/channels\/([^\/]+)\/?$/);
            if (!urlMatch) {
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    '**Error:** Invalid Mattermost URL format.\n\n' +
                    'Expected: `https://mattermost.example.com/team/channels/channel`\n\n' +
                    'Just copy the URL from your browser when viewing the channel!'
                );
                return;
            }

            mattermostUrl = urlMatch[1];
            teamName = urlMatch[2];
            channelName = urlMatch[3];

            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                `Starting import from Mattermost channel **${teamName}/${channelName}**...`
            );

            // Authenticate
            token = await this.authenticate(http, mattermostUrl, username, password);
            if (!token) {
                await this.sendNotifyMessage(room, sender, modify, '**Error:** Failed to authenticate with Mattermost. Check your credentials.');
                return;
            }

            await this.sendNotifyMessage(room, sender, modify, 'Authenticated with Mattermost.');
        }

        if (authMode === 'admin_token') {
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                `Starting import from Mattermost channel **${teamName}/${channelName}**...`
            );
        }

        try {
            // Get team ID
            const teamId = await this.getTeamId(http, mattermostUrl, token, teamName);
            if (!teamId) {
                await this.sendNotifyMessage(room, sender, modify, `**Error:** Team "${teamName}" not found.`);
                return;
            }

            // Get channel ID
            const channelId = await this.getChannelId(http, mattermostUrl, token, teamId, channelName);
            if (!channelId) {
                await this.sendNotifyMessage(room, sender, modify, `**Error:** Channel "${channelName}" not found in team "${teamName}".`);
                return;
            }

            await this.sendNotifyMessage(room, sender, modify, 'Found channel. Checking for previous imports...');

            // Check for previous imports
            const importRecord = await this.getImportRecord(read.getPersistenceReader(), room.id, channelId);
            let sinceTimestamp = 0;
            let isIncrementalImport = false;

            if (importRecord) {
                sinceTimestamp = importRecord.lastImportedTimestamp;
                isIncrementalImport = true;
                const lastDate = new Date(importRecord.lastImportDate).toLocaleString('sv-SE');
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    `Found previous import (${importRecord.totalImported} messages imported on ${lastDate}).\n` +
                    `Fetching only new messages since then...`
                );
            } else {
                await this.sendNotifyMessage(room, sender, modify, 'No previous import found. Fetching all messages...');
            }

            // Fetch posts (all or since last import)
            const posts = await this.getAllPosts(http, mattermostUrl, token, channelId, sinceTimestamp);

            if (posts.length === 0) {
                if (isIncrementalImport) {
                    await this.sendNotifyMessage(room, sender, modify, 'No new messages found since last import.');
                } else {
                    await this.sendNotifyMessage(room, sender, modify, 'No messages found in the channel.');
                }
                return;
            }

            const newOrAll = isIncrementalImport ? 'new ' : '';
            await this.sendNotifyMessage(room, sender, modify, `Found **${posts.length}** ${newOrAll}messages. Starting import...`);

            // Sort posts by create_at (oldest first)
            posts.sort((a, b) => a.create_at - b.create_at);

            let importedCount = 0;
            let errorCount = 0;
            let skippedCount = 0;
            let threadedCount = 0;
            const batchSize = 50;
            let lastImportedPost: MattermostPost | null = null;

            // Map Mattermost post IDs to Rocket.Chat message IDs for threading
            const postIdToMessageId: Map<string, string> = new Map();

            for (let i = 0; i < posts.length; i++) {
                const post = posts[i];

                // Skip system messages
                if (post.type && post.type !== '') {
                    skippedCount++;
                    continue;
                }

                try {
                    // Check if this is a reply to another post
                    let threadId: string | undefined;
                    if (post.root_id && post.root_id !== '') {
                        threadId = postIdToMessageId.get(post.root_id);
                        if (threadId) {
                            threadedCount++;
                        }
                    }

                    const messageId = await this.importPost(http, modify, read, room, sender, mattermostUrl, token, post, threadId);

                    // Store the mapping for potential replies
                    if (messageId) {
                        postIdToMessageId.set(post.id, messageId);
                    }

                    importedCount++;
                    lastImportedPost = post;

                    // Progress update every 50 messages
                    if (importedCount % batchSize === 0) {
                        await this.sendNotifyMessage(
                            room,
                            sender,
                            modify,
                            `Progress: ${importedCount}/${posts.length} messages imported...`
                        );
                    }

                    // Small delay to avoid rate limiting
                    await this.sleep(100);
                } catch (error) {
                    errorCount++;
                    this.app.getLogger().error(`Failed to import post ${post.id}:`, error);
                }
            }

            // Save import record for future incremental imports
            if (lastImportedPost) {
                const newRecord: ImportRecord = {
                    roomId: room.id,
                    mattermostChannelId: channelId,
                    mattermostUrl: mattermostUrl,
                    teamName: teamName,
                    channelName: channelName,
                    lastImportedTimestamp: lastImportedPost.create_at,
                    lastImportedPostId: lastImportedPost.id,
                    totalImported: (importRecord?.totalImported || 0) + importedCount,
                    lastImportDate: new Date().toISOString(),
                };

                await this.saveImportRecord(persistence, newRecord);
            }

            const totalImported = (importRecord?.totalImported || 0) + importedCount;
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                `**Import complete!**\n` +
                `- Imported: ${importedCount} ${newOrAll}messages\n` +
                `- Threaded replies: ${threadedCount}\n` +
                `- Errors: ${errorCount}\n` +
                `- Skipped (system messages): ${skippedCount}\n` +
                `- Total imported to this room: ${totalImported} messages`
            );

        } catch (error) {
            this.app.getLogger().error('Import failed:', error);
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                `**Error:** Import failed - ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    private async checkPermission(user: IUser, read: IRead): Promise<boolean> {
        const settings = read.getEnvironmentReader().getSettings();

        // Get allowed roles (comma-separated)
        const allowedRolesStr = await settings.getValueById('allowed_roles') as string;
        const allowedRoles = allowedRolesStr.split(',').map(r => r.trim().toLowerCase()).filter(r => r);

        // Get allowed users (comma-separated usernames)
        const allowedUsersStr = await settings.getValueById('allowed_users') as string;
        const allowedUsers = allowedUsersStr ? allowedUsersStr.split(',').map(u => u.trim().toLowerCase()).filter(u => u) : [];

        // Check if user is in allowed users list
        if (allowedUsers.length > 0 && allowedUsers.includes(user.username.toLowerCase())) {
            return true;
        }

        // Check if user has any of the allowed roles
        if (user.roles && allowedRoles.length > 0) {
            for (const role of user.roles) {
                if (allowedRoles.includes(role.toLowerCase())) {
                    return true;
                }
            }
        }

        return false;
    }

    private getImportAssociation(roomId: string, mattermostChannelId: string): RocketChatAssociationRecord {
        return new RocketChatAssociationRecord(
            RocketChatAssociationModel.MISC,
            `import_${roomId}_${mattermostChannelId}`
        );
    }

    private getRoomImportAssociation(roomId: string): RocketChatAssociationRecord {
        return new RocketChatAssociationRecord(
            RocketChatAssociationModel.ROOM,
            roomId
        );
    }

    private async getImportRecord(
        persistenceRead: IPersistenceRead,
        roomId: string,
        mattermostChannelId: string
    ): Promise<ImportRecord | null> {
        const association = this.getImportAssociation(roomId, mattermostChannelId);
        this.app.getLogger().info(`Looking for import record: room=${roomId}, channel=${mattermostChannelId}`);

        const records = await persistenceRead.readByAssociation(association);
        this.app.getLogger().info(`Found ${records?.length || 0} records`);

        if (records && records.length > 0) {
            this.app.getLogger().info(`Returning record: ${JSON.stringify(records[0])}`);
            return records[0] as ImportRecord;
        }

        return null;
    }

    private async saveImportRecord(persistence: IPersistence, record: ImportRecord): Promise<void> {
        const association = this.getImportAssociation(record.roomId, record.mattermostChannelId);
        this.app.getLogger().info(`Saving import record for room ${record.roomId}, channel ${record.mattermostChannelId}`);
        this.app.getLogger().info(`Record: ${JSON.stringify(record)}`);

        try {
            // First, remove any existing records with this association
            await persistence.removeByAssociation(association);
            this.app.getLogger().info('Removed old records');

            // Then create the new record
            await persistence.createWithAssociation(record, association);
            this.app.getLogger().info('Import record saved successfully');
        } catch (error) {
            this.app.getLogger().error('Failed to save import record:', error);
        }
    }

    private async authenticate(http: IHttp, baseUrl: string, username: string, password: string): Promise<string | null> {
        try {
            const response = await http.post(`${baseUrl}/api/v4/users/login`, {
                headers: { 'Content-Type': 'application/json' },
                data: { login_id: username, password: password },
            });

            if (response.statusCode === 200 && response.headers) {
                const token = response.headers['token'];
                if (token) {
                    return token;
                }
            }

            return null;
        } catch (error) {
            this.app.getLogger().error('Authentication error:', error);
            return null;
        }
    }

    private async getTeamId(http: IHttp, baseUrl: string, token: string, teamName: string): Promise<string | null> {
        try {
            const response = await http.get(`${baseUrl}/api/v4/teams/name/${encodeURIComponent(teamName)}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.statusCode === 200 && response.data) {
                return response.data.id;
            }

            return null;
        } catch (error) {
            this.app.getLogger().error('Get team error:', error);
            return null;
        }
    }

    private async getChannelId(http: IHttp, baseUrl: string, token: string, teamId: string, channelName: string): Promise<string | null> {
        try {
            const response = await http.get(`${baseUrl}/api/v4/teams/${teamId}/channels/name/${encodeURIComponent(channelName)}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.statusCode === 200 && response.data) {
                return response.data.id;
            }

            return null;
        } catch (error) {
            this.app.getLogger().error('Get channel error:', error);
            return null;
        }
    }

    private async getAllPosts(
        http: IHttp,
        baseUrl: string,
        token: string,
        channelId: string,
        sinceTimestamp: number = 0
    ): Promise<MattermostPost[]> {
        const allPosts: MattermostPost[] = [];
        let page = 0;
        const perPage = 200;

        while (true) {
            try {
                let url = `${baseUrl}/api/v4/channels/${channelId}/posts?page=${page}&per_page=${perPage}`;

                // If we have a since timestamp, use the since parameter to get only newer posts
                if (sinceTimestamp > 0) {
                    url = `${baseUrl}/api/v4/channels/${channelId}/posts?since=${sinceTimestamp}`;
                }

                const response = await http.get(url, {
                    headers: { 'Authorization': `Bearer ${token}` },
                });

                if (response.statusCode !== 200 || !response.data) {
                    break;
                }

                const data = response.data;
                const posts = data.posts;
                const order = data.order;

                if (!order || order.length === 0) {
                    break;
                }

                for (const postId of order) {
                    if (posts[postId]) {
                        const post = posts[postId];
                        // Skip posts that are exactly at the since timestamp (already imported)
                        if (sinceTimestamp > 0 && post.create_at <= sinceTimestamp) {
                            continue;
                        }
                        allPosts.push(post);
                    }
                }

                // If using since parameter, we get all posts in one request
                if (sinceTimestamp > 0) {
                    break;
                }

                if (order.length < perPage) {
                    break;
                }

                page++;
            } catch (error) {
                this.app.getLogger().error('Get posts error:', error);
                break;
            }
        }

        return allPosts;
    }

    private async getUser(http: IHttp, baseUrl: string, token: string, userId: string): Promise<MattermostUser | null> {
        if (this.userCache.has(userId)) {
            return this.userCache.get(userId) || null;
        }

        try {
            const response = await http.get(`${baseUrl}/api/v4/users/${userId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.statusCode === 200 && response.data) {
                const user: MattermostUser = response.data;
                this.userCache.set(userId, user);
                return user;
            }

            return null;
        } catch (error) {
            this.app.getLogger().error('Get user error:', error);
            return null;
        }
    }

    private async getUserMapping(read: IRead): Promise<Record<string, string>> {
        try {
            const mappingStr = await read.getEnvironmentReader().getSettings().getValueById('user_mapping') as string;
            if (mappingStr && mappingStr.trim()) {
                return JSON.parse(mappingStr);
            }
        } catch (error) {
            this.app.getLogger().error('Failed to parse user mapping JSON:', error);
        }
        return {};
    }

    private async getRocketChatUser(read: IRead, mmUsername: string): Promise<IUser | null> {
        if (this.rcUserCache.has(mmUsername)) {
            return this.rcUserCache.get(mmUsername) || null;
        }

        // Check if there's a manual mapping for this username
        const mapping = await this.getUserMapping(read);
        const rcUsername = mapping[mmUsername] || mmUsername;

        try {
            const rcUser = await read.getUserReader().getByUsername(rcUsername);
            if (rcUser) {
                this.rcUserCache.set(mmUsername, rcUser);
                return rcUser;
            }
        } catch (error) {
            this.app.getLogger().debug(`No RC user found for username "${rcUsername}"`);
        }

        this.rcUserCache.set(mmUsername, null);
        return null;
    }

    private async importPost(
        http: IHttp,
        modify: IModify,
        read: IRead,
        room: IRoom,
        sender: IUser,
        baseUrl: string,
        token: string,
        post: MattermostPost,
        threadId?: string
    ): Promise<string | undefined> {
        const mmUser = await this.getUser(http, baseUrl, token, post.user_id);
        const username = mmUser?.username || 'unknown';
        const displayName = mmUser?.first_name && mmUser?.last_name
            ? `${mmUser.first_name} ${mmUser.last_name}`
            : mmUser?.nickname || username;

        // Try to map Mattermost user to Rocket.Chat user by username
        let actualSender = sender;
        if (mmUser) {
            const rcUser = await this.getRocketChatUser(read, mmUser.username);
            if (rcUser) {
                actualSender = rcUser;
            }
        }

        const date = new Date(post.create_at);
        const timestamp = date.toISOString().replace('T', ' ').substring(0, 16);

        // If we matched an RC user, just show the timestamp (user is the sender)
        // If not matched, show the full header with Mattermost username
        let messageText: string;
        if (actualSender !== sender) {
            messageText = `_${timestamp} (imported from Mattermost)_\n\n${post.message}`;
        } else {
            messageText = `**${displayName} (${username}) — ${timestamp}**\n\n${post.message}`;
        }

        // Handle file attachments - download from Mattermost and upload to Rocket.Chat
        const uploadedFiles: string[] = [];
        if (post.file_ids && post.file_ids.length > 0) {
            for (const fileId of post.file_ids) {
                try {
                    const fileInfo = await this.getFileInfo(http, baseUrl, token, fileId);
                    if (fileInfo) {
                        // Download file content from Mattermost
                        const fileContent = await this.downloadFile(http, baseUrl, token, fileId);
                        if (fileContent) {
                            // Upload to Rocket.Chat
                            await modify.getCreator().getUploadCreator().uploadBuffer(
                                fileContent,
                                {
                                    filename: fileInfo.name,
                                    room: room,
                                    user: sender,
                                }
                            );
                            uploadedFiles.push(fileInfo.name);
                        } else {
                            // Fallback to link if download fails
                            const fileUrl = `${baseUrl}/api/v4/files/${fileId}`;
                            messageText += `\n\n**Attachment (link):** [${fileInfo.name}](${fileUrl})`;
                        }
                    }
                } catch (error) {
                    this.app.getLogger().error(`Failed to upload file ${fileId}:`, error);
                    // Fallback to link on error
                    const fileInfo = await this.getFileInfo(http, baseUrl, token, fileId);
                    if (fileInfo) {
                        const fileUrl = `${baseUrl}/api/v4/files/${fileId}`;
                        messageText += `\n\n**Attachment (link):** [${fileInfo.name}](${fileUrl})`;
                    }
                }
            }
        }

        // Add note about uploaded files if any
        if (uploadedFiles.length > 0) {
            messageText += `\n\n_Uploaded: ${uploadedFiles.join(', ')}_`;
        }

        // Send the message (with or without file references)
        const messageBuilder = modify.getCreator().startMessage()
            .setRoom(room)
            .setSender(actualSender)
            .setText(messageText);

        // If this is a reply, set it as a thread reply
        if (threadId) {
            messageBuilder.setThreadId(threadId);
        }

        const messageId = await modify.getCreator().finish(messageBuilder);
        return messageId;
    }

    private async downloadFile(http: IHttp, baseUrl: string, token: string, fileId: string): Promise<Buffer | null> {
        try {
            // Try to get file as base64 from Mattermost (avoids binary corruption)
            const response = await http.get(`${baseUrl}/api/v4/files/${fileId}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                },
            });

            if (response.statusCode === 200 && response.content) {
                // RC Apps Engine returns content as string, which corrupts binary
                // Try to convert from latin1/binary encoding
                return Buffer.from(response.content, 'latin1');
            }

            return null;
        } catch (error) {
            this.app.getLogger().error('Download file error:', error);
            return null;
        }
    }

    private async getFileInfo(http: IHttp, baseUrl: string, token: string, fileId: string): Promise<MattermostFile | null> {
        try {
            const response = await http.get(`${baseUrl}/api/v4/files/${fileId}/info`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });

            if (response.statusCode === 200 && response.data) {
                return response.data;
            }

            return null;
        } catch (error) {
            this.app.getLogger().error('Get file info error:', error);
            return null;
        }
    }

    private async sendNotifyMessage(room: IRoom, sender: IUser, modify: IModify, text: string): Promise<void> {
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
