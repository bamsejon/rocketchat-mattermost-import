import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import {
  RCMessage,
  RCUser,
  RCRoom,
  ImportRecord,
  RCAppsPersistenceDoc,
  Config,
} from './types';

const RC_APP_ID = 'c7d4e8f9-3b2a-4c5d-9e1f-6a8b0d2c4e7f';

// Replicate Rocket.Chat's Random.id() — 17 chars, base62
const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function generateRCId(length = 17): string {
  let id = '';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    id += ID_CHARS[bytes[i] % ID_CHARS.length];
  }
  return id;
}

export class MongoWriter {
  private client: MongoClient;
  private db!: Db;
  private messages!: Collection<RCMessage>;
  private rooms!: Collection<RCRoom>;
  private subscriptions!: Collection;
  private users!: Collection<RCUser>;
  private appsPersistence!: Collection<RCAppsPersistenceDoc>;

  constructor(private config: Config) {
    this.client = new MongoClient(config.mongoUri);
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db();
    this.messages = this.db.collection('rocketchat_message');
    this.rooms = this.db.collection('rocketchat_room');
    this.subscriptions = this.db.collection('rocketchat_subscription');
    this.users = this.db.collection('users');
    this.appsPersistence = this.db.collection('rocketchat_apps_persistence');
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  /**
   * Verify the target room exists and return it.
   */
  async getRoom(roomId: string): Promise<RCRoom | null> {
    return this.rooms.findOne({ _id: roomId as any }) as any;
  }

  /**
   * Get all RC users (for user mapping).
   */
  async getAllUsers(): Promise<RCUser[]> {
    return this.users.find({ active: true }).toArray() as any;
  }

  /**
   * Get a specific user by username.
   */
  async getUserByUsername(username: string): Promise<RCUser | null> {
    return this.users.findOne({ username }) as any;
  }

  /**
   * Bulk insert messages into rocketchat_message.
   * Returns the number of inserted documents.
   */
  async bulkInsertMessages(messages: RCMessage[]): Promise<number> {
    if (messages.length === 0) return 0;

    // Insert in batches
    let inserted = 0;
    for (let i = 0; i < messages.length; i += this.config.batchSize) {
      const batch = messages.slice(i, i + this.config.batchSize);
      const result = await this.messages.insertMany(batch as any[], { ordered: false });
      inserted += result.insertedCount;
    }
    return inserted;
  }

  /**
   * Bulk update thread parent messages (tcount, tlm, replies).
   */
  async updateThreadParents(
    threadUpdates: Map<string, { tcount: number; tlm: Date; replies: Set<string> }>
  ): Promise<number> {
    if (threadUpdates.size === 0) return 0;

    const ops = [];
    for (const [parentId, update] of threadUpdates) {
      ops.push({
        updateOne: {
          filter: { _id: parentId as any },
          update: {
            $set: {
              tcount: update.tcount,
              tlm: update.tlm,
            },
            $addToSet: {
              replies: { $each: [...update.replies] },
            },
          },
        },
      });
    }

    const result = await this.messages.bulkWrite(ops);
    return result.modifiedCount;
  }

  /**
   * Update room metadata after import (msgs count, lastMessage, lm).
   */
  async updateRoom(roomId: string, totalNewMessages: number, lastMessage: RCMessage): Promise<void> {
    await this.rooms.updateOne(
      { _id: roomId as any },
      {
        $inc: { msgs: totalNewMessages },
        $set: {
          lm: lastMessage.ts,
          _updatedAt: new Date(),
          lastMessage: {
            _id: lastMessage._id,
            rid: lastMessage.rid,
            msg: lastMessage.msg.substring(0, 200),
            ts: lastMessage.ts,
            u: lastMessage.u,
            _updatedAt: lastMessage._updatedAt,
          },
        },
      }
    );
  }

  /**
   * Mark all messages as read for all subscribers of the room.
   */
  async markAllRead(roomId: string): Promise<void> {
    const now = new Date();
    await this.subscriptions.updateMany(
      { rid: roomId },
      {
        $set: {
          unread: 0,
          ls: now,
          _updatedAt: now,
        },
      }
    );
  }

  /**
   * Read existing import record from rocketchat_apps_persistence.
   * Matches the RC app's format: appId + association key.
   */
  async getImportRecord(roomId: string, mmChannelId: string): Promise<ImportRecord | null> {
    const associationId = `import_${roomId}_${mmChannelId}`;
    const doc = await this.appsPersistence.findOne({
      appId: RC_APP_ID,
      'associations.id': associationId,
    });

    if (doc) {
      return doc.data;
    }
    return null;
  }

  /**
   * Write import record to rocketchat_apps_persistence.
   * Compatible with the RC app's persistence format so incremental sync works.
   */
  async saveImportRecord(record: ImportRecord, mmChannelId: string): Promise<void> {
    const associationId = `import_${record.roomId}_${mmChannelId}`;
    const now = new Date();

    // Remove existing records
    await this.appsPersistence.deleteMany({
      appId: RC_APP_ID,
      'associations.id': associationId,
    });

    // Insert new record
    await this.appsPersistence.insertOne({
      _id: generateRCId() as any,
      appId: RC_APP_ID,
      associations: [
        { model: 'misc', id: associationId },
      ],
      data: record,
      _createdAt: now,
      _updatedAt: now,
    });
  }
}
