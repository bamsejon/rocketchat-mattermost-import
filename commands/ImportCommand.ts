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

interface MattermostPost {
    id: string;
    create_at: number;
    update_at: number;
    user_id: string;
    channel_id: string;
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
}

interface MattermostFile {
    id: string;
    name: string;
    extension: string;
    size: number;
    mime_type: string;
}

export class ImportCommand implements ISlashCommand {
    public command = 'import';
    public i18nParamsExample = 'import_params_example';
    public i18nDescription = 'import_description';
    public providesPreview = false;

    private userCache: Map<string, MattermostUser> = new Map();

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

        // Parse arguments: mattermost <full-url> <username> <password>
        // URL format: https://mattermost.example.com/team/channels/channel
        if (args.length < 4 || args[0] !== 'mattermost') {
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                '**Usage:** `/import mattermost <channel-url> <username> <password>`\n\n' +
                '**Example:** `/import mattermost https://mattermost.example.com/myteam/channels/general user pass`\n\n' +
                'Just paste the full URL from your Mattermost channel!'
            );
            return;
        }

        const fullUrl = args[1];
        const username = args[2];
        const password = args[3];

        // Parse the Mattermost URL to extract base URL, team, and channel
        // Format: https://host/team/channels/channel
        const urlMatch = fullUrl.match(/^(https?:\/\/[^\/]+)\/([^\/]+)\/channels\/([^\/]+)\/?$/);
        if (!urlMatch) {
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                '**Error:** Invalid Mattermost URL format.\n\n' +
                'Expected format: `https://mattermost.example.com/team/channels/channel`\n\n' +
                'Just copy the URL from your browser when viewing the channel in Mattermost.'
            );
            return;
        }

        const mattermostUrl = urlMatch[1];
        const teamName = urlMatch[2];
        const channelName = urlMatch[3];

        await this.sendNotifyMessage(
            room,
            sender,
            modify,
            `Starting import from Mattermost channel **${teamName}/${channelName}**...`
        );

        try {
            // Step 1: Authenticate with Mattermost
            const token = await this.authenticate(http, mattermostUrl, username, password);
            if (!token) {
                await this.sendNotifyMessage(room, sender, modify, '**Error:** Failed to authenticate with Mattermost. Check your credentials.');
                return;
            }

            await this.sendNotifyMessage(room, sender, modify, 'Authenticated with Mattermost.');

            // Step 2: Get team ID
            const teamId = await this.getTeamId(http, mattermostUrl, token, teamName);
            if (!teamId) {
                await this.sendNotifyMessage(room, sender, modify, `**Error:** Team "${teamName}" not found.`);
                return;
            }

            // Step 3: Get channel ID
            const channelId = await this.getChannelId(http, mattermostUrl, token, teamId, channelName);
            if (!channelId) {
                await this.sendNotifyMessage(room, sender, modify, `**Error:** Channel "${channelName}" not found in team "${teamName}".`);
                return;
            }

            await this.sendNotifyMessage(room, sender, modify, 'Found channel. Fetching messages...');

            // Step 4: Fetch all posts from the channel
            const posts = await this.getAllPosts(http, mattermostUrl, token, channelId);
            if (posts.length === 0) {
                await this.sendNotifyMessage(room, sender, modify, 'No messages found in the channel.');
                return;
            }

            await this.sendNotifyMessage(room, sender, modify, `Found **${posts.length}** messages. Starting import...`);

            // Step 5: Import messages in chronological order
            // Sort posts by create_at (oldest first)
            posts.sort((a, b) => a.create_at - b.create_at);

            let importedCount = 0;
            let errorCount = 0;
            const batchSize = 50;

            for (let i = 0; i < posts.length; i++) {
                const post = posts[i];

                // Skip system messages
                if (post.type && post.type !== '') {
                    continue;
                }

                try {
                    await this.importPost(http, modify, room, sender, mattermostUrl, token, post);
                    importedCount++;

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

            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                `**Import complete!**\n- Imported: ${importedCount} messages\n- Errors: ${errorCount}\n- Skipped (system messages): ${posts.length - importedCount - errorCount}`
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

    private async authenticate(http: IHttp, baseUrl: string, username: string, password: string): Promise<string | null> {
        try {
            const response = await http.post(`${baseUrl}/api/v4/users/login`, {
                headers: { 'Content-Type': 'application/json' },
                data: { login_id: username, password: password },
            });

            if (response.statusCode === 200 && response.headers) {
                // Token is in the response header
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

    private async getAllPosts(http: IHttp, baseUrl: string, token: string, channelId: string): Promise<MattermostPost[]> {
        const allPosts: MattermostPost[] = [];
        let page = 0;
        const perPage = 200;

        while (true) {
            try {
                const response = await http.get(
                    `${baseUrl}/api/v4/channels/${channelId}/posts?page=${page}&per_page=${perPage}`,
                    {
                        headers: { 'Authorization': `Bearer ${token}` },
                    }
                );

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
                        allPosts.push(posts[postId]);
                    }
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
        // Check cache first
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

    private async importPost(
        http: IHttp,
        modify: IModify,
        room: IRoom,
        sender: IUser,
        baseUrl: string,
        token: string,
        post: MattermostPost
    ): Promise<void> {
        // Get the original poster's username
        const mmUser = await this.getUser(http, baseUrl, token, post.user_id);
        const username = mmUser?.username || 'unknown';
        const displayName = mmUser?.first_name && mmUser?.last_name
            ? `${mmUser.first_name} ${mmUser.last_name}`
            : mmUser?.nickname || username;

        // Format timestamp
        const date = new Date(post.create_at);
        const timestamp = date.toISOString().replace('T', ' ').substring(0, 16);

        // Build the message
        let messageText = `**[${displayName} (${username}) ${timestamp}]**\n${post.message}`;

        // Check for file attachments
        if (post.file_ids && post.file_ids.length > 0) {
            const fileLinks: string[] = [];
            for (const fileId of post.file_ids) {
                const fileInfo = await this.getFileInfo(http, baseUrl, token, fileId);
                if (fileInfo) {
                    // Create a link to the file (users will need access to Mattermost to view)
                    const fileUrl = `${baseUrl}/api/v4/files/${fileId}`;
                    fileLinks.push(`[${fileInfo.name}](${fileUrl})`);
                }
            }
            if (fileLinks.length > 0) {
                messageText += `\n\n**Attachments:** ${fileLinks.join(', ')}`;
            }
        }

        // Send the message
        const messageBuilder = modify.getCreator().startMessage()
            .setRoom(room)
            .setSender(sender)
            .setText(messageText);

        await modify.getCreator().finish(messageBuilder);
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
