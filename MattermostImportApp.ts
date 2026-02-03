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
            i18nLabel: 'setting_auth_mode_label',
            i18nDescription: 'setting_auth_mode_description',
            values: [
                { key: 'user_credentials', i18nLabel: 'setting_auth_mode_user' },
                { key: 'admin_token', i18nLabel: 'setting_auth_mode_token' },
            ],
        });

        await configuration.settings.provideSetting({
            id: 'mattermost_url',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'setting_mattermost_url_label',
            i18nDescription: 'setting_mattermost_url_description',
        });

        await configuration.settings.provideSetting({
            id: 'admin_token',
            type: SettingType.PASSWORD,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'setting_admin_token_label',
            i18nDescription: 'setting_admin_token_description',
        });

        // Permission Settings
        await configuration.settings.provideSetting({
            id: 'allowed_roles',
            type: SettingType.STRING,
            packageValue: 'admin',
            required: true,
            public: false,
            i18nLabel: 'setting_allowed_roles_label',
            i18nDescription: 'setting_allowed_roles_description',
        });

        await configuration.settings.provideSetting({
            id: 'allowed_users',
            type: SettingType.STRING,
            packageValue: '',
            required: false,
            public: false,
            i18nLabel: 'setting_allowed_users_label',
            i18nDescription: 'setting_allowed_users_description',
        });
    }
}
