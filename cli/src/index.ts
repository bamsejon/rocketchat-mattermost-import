#!/usr/bin/env node

import chalk from 'chalk';
import { parseConfig } from './config';
import { MattermostClient } from './mattermost-client';
import { MongoWriter, generateRCId } from './mongo-writer';
import { UserMapper } from './user-mapper';
import { ThreadResolver } from './thread-resolver';
import { createProgressBar } from './progress';
import { RCMessage, MattermostPost, ImportRecord, Config } from './types';

async function main(): Promise<void> {
  const config = parseConfig();

  console.log(chalk.bold('\n  Mattermost → Rocket.Chat Bulk Import\n'));

  if (config.dryRun) {
    console.log(chalk.yellow('  DRY RUN — no data will be written to MongoDB\n'));
  }

  console.log(`  MM server:   ${config.mmUrl}`);
  console.log(`  MM channel:  ${config.mmTeam}/${config.mmChannel}`);
  console.log(`  MongoDB:     ${config.mongoUri}`);
  console.log(`  RC room:     ${config.rcRoomId}`);
  console.log(`  User mode:   ${config.userMode}`);
  console.log(`  Fallback:    ${config.fallbackUser}`);
  console.log(`  Skip files:  ${config.skipFiles}`);
  console.log();

  // ─── Step 1: Connect to MongoDB ───
  const writer = new MongoWriter(config);
  console.log(chalk.dim('Connecting to MongoDB...'));
  await writer.connect();

  try {
    // Verify room exists
    const room = await writer.getRoom(config.rcRoomId);
    if (!room) {
      console.error(chalk.red(`Error: Room "${config.rcRoomId}" not found in Rocket.Chat`));
      process.exit(1);
    }
    console.log(chalk.green(`  Room found: ${room.name || room.fname || room._id} (${room.msgs} messages)`));

    // ─── Step 2: Initialize user mapper ───
    console.log(chalk.dim('Loading RC users from MongoDB...'));
    const userMapper = new UserMapper(config, writer);
    await userMapper.init();
    console.log(chalk.green(`  Loaded ${userMapper.userCount} RC users`));

    // ─── Step 3: Connect to Mattermost ───
    const mm = new MattermostClient(config.mmUrl, config.mmToken);

    console.log(chalk.dim('Resolving Mattermost channel...'));
    const teamId = await mm.getTeamId(config.mmTeam);
    const channelId = await mm.getChannelId(teamId, config.mmChannel);
    console.log(chalk.green(`  Channel resolved: ${channelId}`));

    // ─── Step 4: Check for previous import ───
    const prevImport = await writer.getImportRecord(config.rcRoomId, channelId);
    let sinceTimestamp = 0;

    if (prevImport) {
      sinceTimestamp = prevImport.lastImportedTimestamp;
      const lastDate = new Date(prevImport.lastImportDate).toLocaleString('sv-SE');
      console.log(chalk.yellow(
        `  Previous import found: ${prevImport.totalImported} messages (last: ${lastDate})`
      ));
      console.log(chalk.dim('  Fetching only new messages...'));
    } else {
      console.log(chalk.dim('  No previous import. Fetching all messages...'));
    }

    // ─── Step 5: Fetch all posts from Mattermost ───
    console.log(chalk.dim('Fetching posts from Mattermost...'));
    const allPosts = await mm.getAllPosts(channelId, sinceTimestamp);

    // Filter out system messages
    const posts = allPosts.filter(p => !p.type || p.type === '');
    const skippedSystem = allPosts.length - posts.length;

    if (posts.length === 0) {
      console.log(chalk.yellow('\n  No messages to import.'));
      if (skippedSystem > 0) console.log(chalk.dim(`  (${skippedSystem} system messages skipped)`));
      return;
    }

    console.log(chalk.green(`  Found ${posts.length} messages to import`));
    if (skippedSystem > 0) console.log(chalk.dim(`  (${skippedSystem} system messages skipped)`));

    // ─── Step 6: Prefetch MM users ───
    console.log(chalk.dim('Prefetching Mattermost user profiles...'));
    await mm.prefetchUsers(posts);

    // ─── Step 7: Build RC messages ───
    console.log(chalk.dim('Building Rocket.Chat messages...'));
    const threadResolver = new ThreadResolver();
    const rcMessages: RCMessage[] = [];
    let matchedUsers = 0;
    let unmatchedUsers = 0;
    const unmatchedUsernames = new Set<string>();

    const bar = createProgressBar(posts.length, 'Building');

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const rcId = generateRCId();
      threadResolver.register(post.id, rcId);

      // Resolve user
      let mmUser;
      try {
        mmUser = await mm.getUser(post.user_id);
      } catch {
        mmUser = null;
      }

      let sender;
      let userMatched = false;
      if (mmUser) {
        [sender, userMatched] = userMapper.resolve(mmUser);
        if (userMatched) {
          matchedUsers++;
        } else {
          unmatchedUsers++;
          unmatchedUsernames.add(mmUser.username);
        }
      } else {
        sender = userMapper.getFallbackUser();
        unmatchedUsers++;
      }

      // Build message text (same format as RC app)
      const date = new Date(post.create_at);
      const timestamp = date.toISOString().replace('T', ' ').substring(0, 16);

      let msg: string;
      if (userMatched) {
        msg = `_${timestamp} (imported from Mattermost)_\n\n${post.message}`;
      } else {
        const displayName = mmUser
          ? (mmUser.first_name && mmUser.last_name
            ? `${mmUser.first_name} ${mmUser.last_name}`
            : mmUser.nickname || mmUser.username)
          : 'unknown';
        const username = mmUser?.username || 'unknown';
        msg = `**${displayName} (${username}) — ${timestamp}**\n\n${post.message}`;
      }

      // Handle file references as text
      if (config.skipFiles && post.file_ids && post.file_ids.length > 0) {
        const fileNames = post.metadata?.files?.map(f => f.name) || post.file_ids;
        msg += `\n\n_Attachments: ${fileNames.join(', ')}_`;
      }

      // Resolve thread
      const tmid = threadResolver.resolve(post.root_id);

      const rcMsg: RCMessage = {
        _id: rcId,
        rid: config.rcRoomId,
        msg,
        ts: date,
        u: {
          _id: sender._id,
          username: sender.username,
          name: sender.name,
        },
        _updatedAt: date,
        groupable: false,
        imported: true,
        importedFrom: 'mattermost',
        mmPostId: post.id,
        ...(tmid ? { tmid } : {}),
      };

      rcMessages.push(rcMsg);
      bar.update(i + 1);
    }
    bar.stop();

    // ─── Step 8: Compute thread updates ───
    const threadUpdates = threadResolver.computeThreadUpdates(rcMessages);
    const threadedCount = rcMessages.filter(m => m.tmid).length;

    // ─── Summary before write ───
    console.log();
    console.log(chalk.bold('  Import Summary:'));
    console.log(`    Messages:        ${rcMessages.length}`);
    console.log(`    Threaded replies: ${threadedCount}`);
    console.log(`    Thread parents:  ${threadUpdates.size}`);
    console.log(`    Users matched:   ${matchedUsers}`);
    console.log(`    Users fallback:  ${unmatchedUsers}`);
    if (unmatchedUsernames.size > 0 && unmatchedUsernames.size <= 20) {
      console.log(chalk.dim(`    Unmatched: ${[...unmatchedUsernames].join(', ')}`));
    }
    console.log();

    if (config.dryRun) {
      console.log(chalk.yellow('  DRY RUN complete. No data written.'));
      return;
    }

    // ─── Step 9: Bulk insert messages ───
    console.log(chalk.dim('Inserting messages into MongoDB...'));
    const insertBar = createProgressBar(rcMessages.length, 'Inserting');

    let totalInserted = 0;
    for (let i = 0; i < rcMessages.length; i += config.batchSize) {
      const batch = rcMessages.slice(i, i + config.batchSize);
      const inserted = await writer.bulkInsertMessages(batch);
      totalInserted += inserted;
      insertBar.update(Math.min(i + config.batchSize, rcMessages.length));
    }
    insertBar.stop();
    console.log(chalk.green(`  Inserted ${totalInserted} messages`));

    // ─── Step 10: Update thread parents ───
    if (threadUpdates.size > 0) {
      console.log(chalk.dim('Updating thread parents...'));
      const updatedThreads = await writer.updateThreadParents(threadUpdates);
      console.log(chalk.green(`  Updated ${updatedThreads} thread parents`));
    }

    // ─── Step 11: Update room metadata ───
    console.log(chalk.dim('Updating room metadata...'));
    const lastMsg = rcMessages[rcMessages.length - 1];
    await writer.updateRoom(config.rcRoomId, rcMessages.length, lastMsg);
    console.log(chalk.green('  Room updated'));

    // ─── Step 12: Mark subscriptions as read ───
    console.log(chalk.dim('Marking subscriptions as read...'));
    await writer.markAllRead(config.rcRoomId);
    console.log(chalk.green('  Subscriptions updated'));

    // ─── Step 13: Save import record ───
    console.log(chalk.dim('Saving import record...'));
    const lastPost = posts[posts.length - 1];
    const importRecord: ImportRecord = {
      roomId: config.rcRoomId,
      mattermostChannelId: channelId,
      mattermostUrl: config.mmUrl,
      teamName: config.mmTeam,
      channelName: config.mmChannel,
      lastImportedTimestamp: lastPost.create_at,
      lastImportedPostId: lastPost.id,
      totalImported: (prevImport?.totalImported || 0) + rcMessages.length,
      lastImportDate: new Date().toISOString(),
    };
    await writer.saveImportRecord(importRecord, channelId);
    console.log(chalk.green('  Import record saved'));

    // ─── Done ───
    console.log();
    console.log(chalk.bold.green('  Import complete!'));
    console.log(`    ${rcMessages.length} messages imported in ~${Math.round(process.uptime())}s`);
    console.log(`    Run /importmattermost in RC for incremental sync going forward`);
    console.log();

  } finally {
    await writer.close();
  }
}

main().catch((err) => {
  console.error(chalk.red(`\nFatal error: ${err.message}`));
  if (err.stack) console.error(chalk.dim(err.stack));
  process.exit(1);
});
