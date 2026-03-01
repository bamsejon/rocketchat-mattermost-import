import { MattermostPost, MattermostPostsResponse, MattermostUser } from './types';

export class MattermostClient {
  private baseUrl: string;
  private token: string;
  private userCache = new Map<string, MattermostUser>();

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private async api<T>(endpoint: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v4${endpoint}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new Error(`MM API ${endpoint}: ${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<T>;
  }

  async getTeamId(teamName: string): Promise<string> {
    const team = await this.api<{ id: string }>(`/teams/name/${encodeURIComponent(teamName)}`);
    return team.id;
  }

  async getChannelId(teamId: string, channelName: string): Promise<string> {
    const ch = await this.api<{ id: string }>(
      `/teams/${teamId}/channels/name/${encodeURIComponent(channelName)}`
    );
    return ch.id;
  }

  async getUser(userId: string): Promise<MattermostUser> {
    const cached = this.userCache.get(userId);
    if (cached) return cached;

    const user = await this.api<MattermostUser>(`/users/${userId}`);
    this.userCache.set(userId, user);
    return user;
  }

  /**
   * Fetch ALL users referenced in a set of posts (bulk prefetch).
   */
  async prefetchUsers(posts: MattermostPost[]): Promise<void> {
    const missingIds = [...new Set(posts.map(p => p.user_id))].filter(
      id => !this.userCache.has(id)
    );
    if (missingIds.length === 0) return;

    // MM API: POST /users/ids
    const res = await fetch(`${this.baseUrl}/api/v4/users/ids`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(missingIds),
    });
    if (!res.ok) {
      // Fall back to individual fetches
      for (const id of missingIds) {
        try { await this.getUser(id); } catch { /* skip */ }
      }
      return;
    }

    const users: MattermostUser[] = await res.json();
    for (const u of users) {
      this.userCache.set(u.id, u);
    }
  }

  /**
   * Fetch all posts in a channel, handling pagination.
   * Returns posts sorted oldest-first.
   */
  async getAllPosts(channelId: string, sinceTimestamp = 0): Promise<MattermostPost[]> {
    const allPosts: MattermostPost[] = [];

    if (sinceTimestamp > 0) {
      // Use since parameter — returns all newer posts in one request
      const data = await this.api<MattermostPostsResponse>(
        `/channels/${channelId}/posts?since=${sinceTimestamp}`
      );
      if (data.order) {
        for (const postId of data.order) {
          const post = data.posts[postId];
          if (post && post.create_at > sinceTimestamp) {
            allPosts.push(post);
          }
        }
      }
    } else {
      // Paginate through all posts
      let page = 0;
      const perPage = 200;

      while (true) {
        const data = await this.api<MattermostPostsResponse>(
          `/channels/${channelId}/posts?page=${page}&per_page=${perPage}`
        );
        if (!data.order || data.order.length === 0) break;

        for (const postId of data.order) {
          const post = data.posts[postId];
          if (post) allPosts.push(post);
        }

        if (data.order.length < perPage) break;
        page++;
      }
    }

    // Sort oldest first
    allPosts.sort((a, b) => a.create_at - b.create_at);
    return allPosts;
  }
}
