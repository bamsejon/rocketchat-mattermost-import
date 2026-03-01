import { RCUser, MattermostUser, Config } from './types';
import { MongoWriter } from './mongo-writer';

export class UserMapper {
  private emailToUser = new Map<string, RCUser>();
  private usernameToUser = new Map<string, RCUser>();
  private mmToRcCache = new Map<string, RCUser | null>();
  private fallbackUser: RCUser | null = null;

  constructor(
    private config: Config,
    private writer: MongoWriter,
  ) {}

  async init(): Promise<void> {
    // Load all RC users from MongoDB
    const users = await this.writer.getAllUsers();
    for (const u of users) {
      this.usernameToUser.set(u.username.toLowerCase(), u);
      if (u.emails) {
        for (const e of u.emails) {
          if (e.address) {
            this.emailToUser.set(e.address.toLowerCase(), u);
          }
        }
      }
    }

    // Load fallback user
    this.fallbackUser = await this.writer.getUserByUsername(this.config.fallbackUser);
    if (!this.fallbackUser) {
      throw new Error(`Fallback user "${this.config.fallbackUser}" not found in Rocket.Chat`);
    }
  }

  get userCount(): number {
    return this.usernameToUser.size;
  }

  getFallbackUser(): RCUser {
    return this.fallbackUser!;
  }

  /**
   * Resolve a Mattermost user to a Rocket.Chat user.
   * Returns [rcUser, matched] — matched=false means fallback was used.
   */
  resolve(mmUser: MattermostUser): [RCUser, boolean] {
    const cached = this.mmToRcCache.get(mmUser.id);
    if (cached !== undefined) {
      return cached ? [cached, true] : [this.fallbackUser!, false];
    }

    let rcUser: RCUser | null = null;

    // 1. Check manual mapping first (if provided)
    if (this.config.userMapping) {
      const mappedUsername =
        this.config.userMapping[mmUser.email] ||
        this.config.userMapping[mmUser.username];
      if (mappedUsername) {
        rcUser = this.usernameToUser.get(mappedUsername.toLowerCase()) || null;
      }
    }

    // 2. Apply mode-specific matching
    if (!rcUser) {
      switch (this.config.userMode) {
        case 'email':
          if (mmUser.email) {
            rcUser = this.emailToUser.get(mmUser.email.toLowerCase()) || null;
          }
          break;
        case 'username':
          rcUser = this.usernameToUser.get(mmUser.username.toLowerCase()) || null;
          break;
        case 'manual':
          // Manual only — already checked above
          break;
      }
    }

    this.mmToRcCache.set(mmUser.id, rcUser);
    return rcUser ? [rcUser, true] : [this.fallbackUser!, false];
  }
}
