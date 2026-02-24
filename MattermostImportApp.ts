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
            id: 'user_mapping_mode',
            type: SettingType.SELECT,
            packageValue: 'email_auto',
            required: true,
            public: false,
            i18nLabel: 'User Mapping Mode',
            i18nDescription: 'How to match Mattermost users to Rocket.Chat users',
            values: [
                { key: 'email_auto', i18nLabel: 'Auto-match by email (recommended)' },
                { key: 'username', i18nLabel: 'Match by username' },
                { key: 'manual', i18nLabel: 'Manual JSON mapping' },
            ],
        });

        await configuration.settings.provideSetting({
            id: 'rc_site_url',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'Rocket.Chat Site URL (optional)',
            i18nDescription: 'Your Rocket.Chat URL (e.g., https://chat.example.com). Auto-detected from server settings if left empty.',
        });

        await configuration.settings.provideSetting({
            id: 'rc_admin_user_id',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'Rocket.Chat Admin User ID',
            i18nDescription: 'Admin user ID for looking up users by email. Required for email auto-matching. Find in Administration > Users > click admin user.',
        });

        await configuration.settings.provideSetting({
            id: 'rc_admin_token',
            type: SettingType.PASSWORD,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'Rocket.Chat Admin Auth Token',
            i18nDescription: 'Admin auth token for looking up users by email. Required for email auto-matching. Generate via: Profile > My Account > Personal Access Tokens.',
        });

        await configuration.settings.provideSetting({
            id: 'user_mapping',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'User Mapping (JSON)',
            i18nDescription: 'Manual JSON mapping. For "manual" mode: {"mm_username": "rc_username"}. For "email_auto" mode as fallback: {"mm_email@example.com": "rc_username"}.',
        });

        // Redirect Settings (Mattermost RC Migrate plugin integration)
        await configuration.settings.provideSetting({
            id: 'enable_redirect',
            type: SettingType.BOOLEAN,
            packageValue: false,
            required: false,
            public: false,
            i18nLabel: 'Enable Mattermost Redirect',
            i18nDescription: 'After import, automatically activate the RC Migrate plugin on the source Mattermost channel to redirect users to this Rocket.Chat channel.',
        });

        await configuration.settings.provideSetting({
            id: 'rc_migrate_api_secret',
            type: SettingType.PASSWORD,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'RC Migrate API Secret',
            i18nDescription: 'The API secret configured in the Mattermost RC Migrate plugin. Required when redirect is enabled.',
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
