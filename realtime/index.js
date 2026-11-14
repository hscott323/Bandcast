import { digestHex, getCookie } from "../lib/server.js";

function sendToSocket(socket, payload) {
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    try {
      socket.close(1011, "Delivery failed");
    } catch {
      return;
    }
  }
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.connect(
        request,
        url.searchParams.get("conversationId"),
        url.searchParams.get("presence") === "1",
      );
    }
    if (url.pathname === "/event" && request.method === "POST") {
      return this.broadcast(request);
    }
    if (url.pathname === "/presence-check" && request.method === "POST") {
      return this.checkPresence(request);
    }
    return new Response("Not found", { status: 404 });
  }

  async connect(request, conversationId, presence) {
    const token = getCookie(request, "bandcast_session");
    if (!token || token.length > 200) {
      return new Response("Unauthorized", { status: 401 });
    }
    if ((!conversationId && !presence) || (conversationId && conversationId.length > 80)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const tokenHash = await digestHex(token);
    const session = await this.env.DB.prepare(
      "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
    ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
    const userId = session?.user_id;
    if (!userId || userId.length > 80) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (presence) {
      return this.connectPresence(userId);
    }
    if (!await this.isActiveMember(conversationId, userId)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [`user:${userId}`]);
    server.serializeAttachment({ userId, conversationId });
    sendToSocket(server, { type: "connected" });
    return new Response(null, { status: 101, webSocket: client });
  }

  async connectPresence(userId) {
    const canBroadcast = await this.shouldBroadcastPresence(userId);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [`user:${userId}`]);
    server.serializeAttachment({ userId, presence: true, canBroadcast });
    sendToSocket(server, { type: "connected" });

    const onlineUsers = new Set();
    for (const socket of this.state.getWebSockets()) {
      const attachment = socket.deserializeAttachment();
      if (attachment?.presence
        && attachment.canBroadcast
        && attachment.userId !== userId) {
        onlineUsers.add(attachment.userId);
      }
    }
    for (const onlineUserId of onlineUsers) {
      sendToSocket(server, { type: "presence", userId: onlineUserId, online: true });
    }

    if (canBroadcast) {
      this.broadcastPresence(server, userId, true);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcastPresence(origin, userId, online) {
    this.state.getWebSockets().forEach((socket) => {
      const attachment = socket.deserializeAttachment();
      if (socket !== origin && attachment?.presence) {
        sendToSocket(socket, { type: "presence", userId, online });
      }
    });
  }

  async checkPresence(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Invalid request", { status: 400 });
    }
    const userId = body?.userId;
    if (typeof userId !== "string" || !userId || userId.length > 80) {
      return new Response("Invalid request", { status: 400 });
    }
    const stillConnected = this.state.getWebSockets()
      .some((socket) => socket.deserializeAttachment()?.userId === userId);
    if (!stillConnected && await this.shouldBroadcastPresence(userId)) {
      this.broadcastPresence(null, userId, false);
    }
    return new Response(null, { status: 204 });
  }

  async notifyPresenceOffline(userId) {
    try {
      const id = this.env.CHAT_ROOMS.idFromName("presence:global");
      await this.env.CHAT_ROOMS.get(id).fetch("https://bandcast.internal/presence-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
    } catch (error) {
      console.error("Could not check global presence after a WebSocket closed.", error);
    }
  }

  async broadcast(request) {
    let event;
    try {
      event = await request.json();
    } catch {
      return new Response("Invalid event", { status: 400 });
    }
    if (!event
      || !["message", "message-update", "message-delete"].includes(event.type)
      || typeof event.conversationId !== "string"
      || event.conversationId.length > 80) {
      return new Response("Invalid event", { status: 400 });
    }

    await this.broadcastToMembers(null, event.conversationId, event);
    return new Response(null, { status: 204 });
  }

  async isActiveMember(conversationId, userId) {
    const member = await this.env.DB.prepare(`
      SELECT 1 FROM conversation_members cm
      JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = ? AND cm.user_id = ? AND cm.left_at IS NULL
        AND (c.kind = 'dm' OR NOT EXISTS (
          SELECT 1 FROM group_bans b WHERE b.conversation_id = c.id AND b.user_id = cm.user_id
        ))
    `).bind(conversationId, userId).first();
    return Boolean(member);
  }

  async shouldBroadcastPresence(userId) {
    const settings = await this.env.DB.prepare(
      "SELECT show_online_status FROM user_settings WHERE user_id = ?",
    ).bind(userId).first();
    return settings?.show_online_status !== 0;
  }

  async broadcastToMembers(origin, conversationId, payload) {
    const members = await this.env.DB.prepare(
      `SELECT cm.user_id FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
       WHERE cm.conversation_id = ? AND cm.left_at IS NULL
         AND (c.kind = 'dm' OR NOT EXISTS (
           SELECT 1 FROM group_bans b WHERE b.conversation_id = c.id AND b.user_id = cm.user_id
         ))`,
    ).bind(conversationId).all();
    const activeUsers = new Set((members.results || []).map((member) => member.user_id));
    this.state.getWebSockets().forEach((socket) => {
      const attachment = socket.deserializeAttachment();
      if (socket !== origin
        && attachment?.conversationId === conversationId
        && activeUsers.has(attachment.userId)) {
        sendToSocket(socket, payload);
      }
    });
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== "string" || message.length > 2048) {
      socket.close(1009, "Message too large");
      return;
    }

    let event;
    try {
      event = JSON.parse(message);
    } catch {
      socket.close(1003, "Invalid message");
      return;
    }
    if (!event || event.type !== "typing" || typeof event.isTyping !== "boolean") {
      socket.close(1008, "Unsupported event");
      return;
    }

    const attachment = socket.deserializeAttachment();
    if (!attachment?.userId || !attachment.conversationId
      || !await this.isActiveMember(attachment.conversationId, attachment.userId)) {
      socket.close(4003, "Group access revoked");
      return;
    }
    if (attachment.userId) {
      await this.broadcastToMembers(socket, attachment.conversationId, {
        type: "typing",
        userId: attachment.userId,
        isTyping: event.isTyping,
      });
    }
  }

  async webSocketClose(socket, code, reason) {
    const attachment = socket.deserializeAttachment();
    try {
      socket.close(code, reason);
    } catch {
      // Socket may already be closed.
    }
    if (attachment?.presence) {
      if (attachment.canBroadcast) {
        const stillConnected = this.state.getWebSockets()
          .filter((item) => item !== socket)
          .some((item) => item.deserializeAttachment()?.userId === attachment.userId);
        if (!stillConnected) {
          this.broadcastPresence(null, attachment.userId, false);
        }
      }
      return;
    }
    if (attachment?.userId && attachment.conversationId) {
      const stillConnected = this.state.getWebSockets(`user:${attachment.userId}`)
        .some((item) => item !== socket);
      if (!stillConnected) {
        await this.notifyPresenceOffline(attachment.userId);
      }
    }
  }

  webSocketError(socket) {
    try {
      socket.close(1011, "Connection error");
    } catch {
      return;
    }
  }
}

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
