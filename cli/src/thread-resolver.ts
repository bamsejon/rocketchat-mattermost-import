/**
 * Resolves Mattermost thread relationships (root_id) to Rocket.Chat thread IDs (tmid).
 *
 * Since we're bulk-inserting, we know all message IDs ahead of time.
 * Two-pass approach:
 *   1. First pass: assign RC IDs to all messages, build MM postId → RC messageId map
 *   2. Second pass: resolve root_id → tmid, collect thread parent updates
 */
export class ThreadResolver {
  // MM post ID → assigned RC message ID
  private mmToRcId = new Map<string, string>();

  /**
   * Register a MM post ID → RC message ID mapping.
   */
  register(mmPostId: string, rcMessageId: string): void {
    this.mmToRcId.set(mmPostId, rcMessageId);
  }

  /**
   * Resolve a MM root_id to a RC tmid.
   * Returns undefined if root_id is empty or the parent wasn't found.
   */
  resolve(rootId: string): string | undefined {
    if (!rootId) return undefined;
    return this.mmToRcId.get(rootId);
  }

  /**
   * Compute thread parent updates: tcount, tlm, replies.
   * Call after all messages have been built.
   */
  computeThreadUpdates(
    messages: Array<{ _id: string; tmid?: string; ts: Date; u: { _id: string } }>
  ): Map<string, { tcount: number; tlm: Date; replies: Set<string> }> {
    const updates = new Map<string, { tcount: number; tlm: Date; replies: Set<string> }>();

    for (const msg of messages) {
      if (!msg.tmid) continue;

      const existing = updates.get(msg.tmid);
      if (existing) {
        existing.tcount++;
        if (msg.ts > existing.tlm) existing.tlm = msg.ts;
        existing.replies.add(msg.u._id);
      } else {
        updates.set(msg.tmid, {
          tcount: 1,
          tlm: msg.ts,
          replies: new Set([msg.u._id]),
        });
      }
    }

    return updates;
  }
}
