import type * as Party from "partykit/server";

function broadcastRoster(room: Party.Room, hostId: string | null) {
  const peerIds = [...room.getConnections()]
    .map((c) => c.id)
    .sort();
  room.broadcast(
    JSON.stringify({
      type: "roster",
      hostId,
      peerIds,
    }),
  );
}

export default class WatchRoomServer implements Party.Server {
  hostId: string | null = null;

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection) {
    if (!this.hostId) {
      this.hostId = conn.id;
    }
    conn.send(JSON.stringify({ type: "welcome", peerId: conn.id }));
    broadcastRoster(this.room, this.hostId);
  }

  onMessage(message: string, sender: Party.Connection) {
    let parsed: { type?: string; to?: string } = {};
    try {
      parsed = JSON.parse(message as string);
    } catch {
      this.room.broadcast(message as string, [sender.id]);
      return;
    }
    if (parsed.type === "rtc" && typeof parsed.to === "string") {
      const target = this.room.getConnection(parsed.to);
      target?.send(message as string);
      return;
    }
    this.room.broadcast(message as string, [sender.id]);
  }

  onClose(conn: Party.Connection) {
    if (this.hostId === conn.id) {
      this.hostId = [...this.room.getConnections()][0]?.id ?? null;
    }
    broadcastRoster(this.room, this.hostId);
  }
}
