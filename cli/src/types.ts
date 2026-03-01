// ─── Mattermost types ───

export interface MattermostPost {
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
    files?: MattermostFile[];
  };
}

export interface MattermostUser {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  nickname: string;
  email: string;
}

export interface MattermostFile {
  id: string;
  name: string;
  extension: string;
  size: number;
  mime_type: string;
}

export interface MattermostPostsResponse {
  order: string[];
  posts: Record<string, MattermostPost>;
  next_post_id: string;
  prev_post_id: string;
}

// ─── Rocket.Chat types (MongoDB documents) ───

export interface RCUser {
  _id: string;
  username: string;
  name?: string;
  emails?: Array<{ address: string; verified: boolean }>;
  roles?: string[];
  active: boolean;
}

export interface RCMessage {
  _id: string;
  rid: string;
  msg: string;
  ts: Date;
  u: {
    _id: string;
    username: string;
    name?: string;
  };
  _updatedAt: Date;
  groupable?: boolean;
  // Thread fields
  tmid?: string;
  tcount?: number;
  tlm?: Date;
  replies?: string[];
  // Import marker
  imported?: boolean;
  importedFrom?: string;
  mmPostId?: string;
}

export interface RCRoom {
  _id: string;
  name?: string;
  fname?: string;
  t: string; // 'c' = channel, 'p' = group, 'd' = DM
  msgs: number;
  lm?: Date;
  lastMessage?: RCMessage;
}

export interface RCSubscription {
  _id: string;
  rid: string;
  'u._id': string;
  unread: number;
  ls?: Date;
}

// ─── Import record (matches RC app's persistence format) ───

export interface ImportRecord {
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

// ─── RC Apps persistence document ───

export interface RCAppsPersistenceDoc {
  _id: string;
  appId: string;
  associations: Array<{
    model: string;
    id: string;
  }>;
  data: ImportRecord;
  _createdAt: Date;
  _updatedAt: Date;
}

// ─── Config ───

export interface Config {
  mmUrl: string;
  mmToken: string;
  mmTeam: string;
  mmChannel: string;
  mongoUri: string;
  rcRoomId: string;
  userMode: 'email' | 'username' | 'manual';
  userMapping?: Record<string, string>;
  fallbackUser: string;
  dryRun: boolean;
  skipFiles: boolean;
  batchSize: number;
}
