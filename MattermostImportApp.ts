import {
    IAppAccessors,
    ILogger,
    IConfigurationExtend,
    IEnvironmentRead,
    IConfigurationModify,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { ISetting, SettingType } from '@rocket.chat/apps-engine/definition/settings';

import { ImportCommand } from './commands/ImportCommand';

export class MattermostImportApp extends App {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {
        // Register slash command
        await configuration.slashCommands.provideSlashCommand(new ImportCommand(this));

        // Authentication Settings
        await configuration.settings.provideSetting({
            id: 'auth_mode',
            type: SettingType.SELECT,
            packageValue: 'user_credentials',
            required: true,
            public: false,
            i18nLabel: 'Authentication Mode',
            i18nDescription: 'Choose how users authenticate with Mattermost',
            values: [
                { key: 'user_credentials', i18nLabel: 'User enters credentials' },
                { key: 'admin_token', i18nLabel: 'Use admin token' },
            ],
        });

        await configuration.settings.provideSetting({
            id: 'mattermost_url',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'Mattermost URL (optional)',
            i18nDescription: 'Base URL for Mattermost server (e.g., https://mattermost.example.com). Optional - can be extracted from channel URL.',
        });

        await configuration.settings.provideSetting({
            id: 'admin_token',
            type: SettingType.PASSWORD,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'Admin Token',
            i18nDescription: 'Mattermost personal access token for importing. Required when using admin token mode. Generate in Mattermost: Profile > Security > Personal Access Tokens.',
        });

        // User Mapping Settings
        await configuration.settings.provideSetting({
            id: 'user_mapping',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'User Mapping (JSON)',
            i18nDescription: 'JSON object mapping Mattermost usernames to Rocket.Chat usernames. Example: {"mm_user1": "rc_user1", "mm_user2": "rc_user2"}. Leave empty to match by identical username.',
        });

        // Permission Settings
        await configuration.settings.provideSetting({
            id: 'allowed_roles',
            type: SettingType.STRING,
            packageValue: 'admin',
            required: true,
            public: false,
            i18nLabel: 'Allowed Roles',
            i18nDescription: 'Comma-separated list of roles that can use the import command (e.g., admin, moderator)',
        });

        await configuration.settings.provideSetting({
            id: 'allowed_users',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'Allowed Users',
            i18nDescription: 'Comma-separated list of usernames that can use the import command (in addition to allowed roles)',
        });
    }
}
