import { Command } from 'commander';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Config } from './types';

export function parseConfig(): Config {
  // Load .env from cli/ directory
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const program = new Command();

  program
    .name('mm-bulk-import')
    .description('Bulk import Mattermost channel history into Rocket.Chat via MongoDB')
    .version('1.0.0')
    .requiredOption('--mm-url <url>', 'Mattermost server URL', process.env.MM_URL)
    .requiredOption('--mm-token <token>', 'Mattermost personal access token', process.env.MM_TOKEN)
    .requiredOption('--mm-team <team>', 'Mattermost team name', process.env.MM_TEAM)
    .requiredOption('--mm-channel <channel>', 'Mattermost channel name', process.env.MM_CHANNEL)
    .requiredOption('--mongo-uri <uri>', 'MongoDB connection URI', process.env.MONGO_URI || 'mongodb://localhost:27017/rocketchat')
    .requiredOption('--rc-room-id <id>', 'Rocket.Chat room ID to import into', process.env.RC_ROOM_ID)
    .option('--user-mode <mode>', 'User mapping mode: email, username, manual', process.env.USER_MODE || 'email')
    .option('--user-mapping <json>', 'JSON string for manual user mapping', process.env.USER_MAPPING)
    .option('--fallback-user <username>', 'RC username for unmapped users', process.env.FALLBACK_USER || 'admin')
    .option('--dry-run', 'Preview without writing to MongoDB', false)
    .option('--skip-files', 'Skip file attachments (include filename as text)', true)
    .option('--no-skip-files', 'Download and import file attachments')
    .option('--batch-size <n>', 'Batch size for bulk insert', '1000')
    .parse();

  const opts = program.opts();

  let userMapping: Record<string, string> | undefined;
  if (opts.userMapping) {
    try {
      userMapping = JSON.parse(opts.userMapping);
    } catch {
      console.error('Error: --user-mapping must be valid JSON');
      process.exit(1);
    }
  }

  return {
    mmUrl: opts.mmUrl.replace(/\/$/, ''),
    mmToken: opts.mmToken,
    mmTeam: opts.mmTeam,
    mmChannel: opts.mmChannel,
    mongoUri: opts.mongoUri,
    rcRoomId: opts.rcRoomId,
    userMode: opts.userMode as Config['userMode'],
    userMapping,
    fallbackUser: opts.fallbackUser,
    dryRun: opts.dryRun,
    skipFiles: opts.skipFiles,
    batchSize: parseInt(opts.batchSize, 10),
  };
}
