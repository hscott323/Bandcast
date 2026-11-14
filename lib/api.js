import {
  ApiError,
  areFriends,
  checkAuthRateLimit,
  constantTimeEqual,
  createSession,
  dispatchRealtime,
  fail,
  hashPassword,
  json,
  legacyPasswordIterations,
  randomHex,
  readJson,
  removeSession,
  requireConversationMember,
  requireGroupOwner,
  requireUser,
  validateString,
  verifySameOrigin,
} from "./server.js";

const maximumUploadBytes = 15 * 1024 * 1024;
const allowedFileTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "application/pdf",
  "text/plain",
]);

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function parsePath(pathname) {
  try {
    return pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  } catch {
    fail(400, "Invalid URL path.");
  }
}

function validateUsername(value) {
  const username = validateString(value, "Username", 3, 24);
  if (!/^[A-Za-z0-9_]+$/.test(username)) {
    fail(400, "Username can contain only letters, numbers, and underscores.");
  }
  return username;
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) {
    fail(400, "Password must be between 10 and 128 characters.");
  }
  return value;
}

function userView(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: row.bio || "",
    avatarColor: row.avatar_color || "#5865f2",
    avatarUrl: row.avatar_file_id ? `/api/files/${encodeURIComponent(row.avatar_file_id)}` : null,
  };
}

async function createUserSession(request, env, user, status = 200) {
  const cookie = await createSession(request, env, user.id);
  return json({ user: userView(user) }, status, { "set-cookie": cookie });
}

async function signUp(request, env) {
  const body = await readJson(request);
  await checkAuthRateLimit(request, env);
  if (body.termsAccepted !== true) {
    fail(400, "Accept the Terms of Service to create an account.");
  }
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  const displayName = typeof body.displayName === "string" && body.displayName.trim()
    ? validateString(body.displayName, "Display name", 1, 40)
    : username;
  const existing = await env.DB.prepare("SELECT 1 FROM users WHERE username = ? COLLATE NOCASE")
    .bind(username)
    .first();
  if (existing) {
    fail(409, "That username is already in use.");
  }

  const id = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await hashPassword(password, salt);
  const now = nowSeconds();
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO users (id, username, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, username, passwordHash, salt, now),
      env.DB.prepare("INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?, ?, ?)")
        .bind(id, displayName, now),
      env.DB.prepare("INSERT INTO user_settings (user_id, updated_at) VALUES (?, ?)")
        .bind(id, now),
    ]);
  } catch (error) {
    console.error("Unable to create account.", error);
    if (String(error?.message || "").includes("UNIQUE")) {
      fail(409, "That username is already in use.");
    }
    fail(500, "Could not create the account.");
  }

  return createUserSession(request, env, {
    id,
    username,
    display_name: displayName,
    bio: "",
    avatar_color: "#5865f2",
    avatar_file_id: null,
  }, 201);
}

async function logIn(request, env) {
  const body = await readJson(request);
  await checkAuthRateLimit(request, env);
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  const account = await env.DB.prepare(`
    SELECT u.id, u.username, u.password_hash, u.password_salt,
      p.display_name, p.bio, p.avatar_color, p.avatar_file_id
    FROM users u JOIN profiles p ON p.user_id = u.id
    WHERE u.username = ? COLLATE NOCASE
  `).bind(username).first();
  const candidateHash = await hashPassword(password, account?.password_salt || "00000000000000000000000000000000");
  let passwordValid = Boolean(account) && constantTimeEqual(candidateHash, account.password_hash);
  if (account && !passwordValid) {
    try {
      const legacyHash = await hashPassword(password, account.password_salt, legacyPasswordIterations);
      passwordValid = constantTimeEqual(legacyHash, account.password_hash);
      if (passwordValid) {
        const upgradedHash = await hashPassword(password, account.password_salt);
        await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
          .bind(upgradedHash, account.id).run();
      }
    } catch {
      // This runtime does not support the legacy iteration count.
    }
  }
  if (!account || !passwordValid) {
    fail(401, "Username or password is incorrect.");
  }
  return createUserSession(request, env, account);
}

async function requireFriendship(env, userId, friendId) {
  if (!await areFriends(env, userId, friendId)) {
    fail(403, "You can only message a friend.");
  }
}

async function conversationList(env, user) {
  const result = await env.DB.prepare(`
    SELECT c.id, c.kind, c.name, c.owner_id, c.icon_file_id, c.created_at,
      peer_user.id AS peer_id, peer_user.username AS peer_username, peer.display_name AS peer_display_name,
      peer.avatar_color AS peer_avatar_color, peer.avatar_file_id AS peer_avatar_file_id,
      latest.body AS last_message, latest.created_at AS last_message_at,
      (SELECT COUNT(*) FROM messages unread
        WHERE unread.conversation_id = c.id
          AND unread.sender_id <> ?
          AND unread.deleted_at IS NULL
          AND unread.created_at > cm.last_read_at) AS unread_count
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id
    LEFT JOIN conversation_members peer_member
      ON peer_member.conversation_id = c.id
      AND peer_member.user_id <> cm.user_id
      AND peer_member.left_at IS NULL
      AND c.kind = 'dm'
    LEFT JOIN profiles peer ON peer.user_id = peer_member.user_id
    LEFT JOIN users peer_user ON peer_user.id = peer_member.user_id
    LEFT JOIN (
      SELECT conversation_id, body, created_at,
        ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY created_at DESC, id DESC) AS position
      FROM messages
      WHERE deleted_at IS NULL
    ) latest ON latest.conversation_id = c.id AND latest.position = 1
    WHERE cm.user_id = ? AND cm.left_at IS NULL
      AND (c.kind = 'dm' OR NOT EXISTS (
        SELECT 1 FROM group_bans b WHERE b.conversation_id = c.id AND b.user_id = cm.user_id
      ))
    ORDER BY COALESCE(latest.created_at, c.created_at) DESC
  `).bind(user.id, user.id).all();

  return (result.results || []).map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.kind === "group" ? row.name : row.peer_display_name,
    ownerId: row.owner_id,
    iconUrl: row.icon_file_id ? `/api/files/${encodeURIComponent(row.icon_file_id)}` : null,
    peer: row.peer_id ? {
      id: row.peer_id,
      username: row.peer_username,
      displayName: row.peer_display_name,
      avatarColor: row.peer_avatar_color,
      avatarUrl: row.peer_avatar_file_id ? `/api/files/${encodeURIComponent(row.peer_avatar_file_id)}` : null,
    } : null,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    unreadCount: row.unread_count,
  }));
}

async function createConversation(request, env, user) {
  const body = await readJson(request);
  if (body.kind === "dm") {
    const peerId = validateString(body.userId, "User", 1, 80);
    if (peerId === user.id) {
      fail(400, "You cannot start a conversation with yourself.");
    }
    await requireFriendship(env, user.id, peerId);
    const [low, high] = [user.id, peerId].sort();
    const dmPairKey = `${low}:${high}`;
    let conversation = await env.DB.prepare("SELECT id FROM conversations WHERE dm_pair_key = ?")
      .bind(dmPairKey).first();
    if (!conversation) {
      const id = crypto.randomUUID();
      const now = nowSeconds();
      try {
        await env.DB.batch([
          env.DB.prepare("INSERT INTO conversations (id, kind, dm_pair_key, created_at) VALUES (?, 'dm', ?, ?)")
            .bind(id, dmPairKey, now),
          env.DB.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?), (?, ?, 'member', ?)")
            .bind(id, low, now, id, high, now),
        ]);
        conversation = { id };
      } catch (error) {
        console.error("Unable to create direct conversation.", error);
        conversation = await env.DB.prepare("SELECT id FROM conversations WHERE dm_pair_key = ?")
          .bind(dmPairKey).first();
        if (!conversation) {
          fail(500, "Could not create the conversation.");
        }
      }
    }
    return json({ conversation });
  }

  if (body.kind !== "group") {
    fail(400, "Conversation kind must be dm or group.");
  }
  const name = validateString(body.name, "Group name", 1, 60);
  const memberIds = Array.isArray(body.memberIds) ? [...new Set(body.memberIds)] : [];
  if (memberIds.length > 99 || memberIds.some((id) => typeof id !== "string" || id.length > 80)) {
    fail(400, "Choose up to 99 valid group members.");
  }
  for (const memberId of memberIds) {
    if (memberId === user.id || !await areFriends(env, user.id, memberId)) {
      fail(400, "Groups can only include your friends.");
    }
  }

  const id = crypto.randomUUID();
  const now = nowSeconds();
  const statements = [
    env.DB.prepare("INSERT INTO conversations (id, kind, name, owner_id, created_at) VALUES (?, 'group', ?, ?, ?)")
      .bind(id, name, user.id, now),
    env.DB.prepare("INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)")
      .bind(id, user.id, now),
    ...memberIds.map((memberId) => env.DB.prepare(
      "INSERT INTO conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)",
    ).bind(id, memberId, now)),
  ];
  await env.DB.batch(statements);
  return json({ conversation: { id, kind: "group", name, ownerId: user.id } }, 201);
}

async function listMessages(env, conversationId, user, url) {
  await requireConversationMember(env, conversationId, user.id);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const before = Number(url.searchParams.get("before")) || Number.MAX_SAFE_INTEGER;
  const result = await env.DB.prepare(`
    SELECT m.id, m.sender_id, u.username AS sender_username, p.display_name AS sender_name,
      p.avatar_color AS sender_avatar_color, p.avatar_file_id AS sender_avatar_file_id,
      m.body, m.gif_url, m.created_at, m.edited_at, m.deleted_at,
      f.id AS file_id, f.file_name, f.content_type, f.byte_size
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    JOIN profiles p ON p.user_id = m.sender_id
    LEFT JOIN files f ON f.id = m.file_id
    WHERE m.conversation_id = ? AND m.created_at < ?
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `).bind(conversationId, before, limit).all();
  return json({
    messages: (result.results || []).reverse().map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderUsername: row.sender_username,
      senderName: row.sender_name,
      senderAvatarColor: row.sender_avatar_color,
      senderAvatarUrl: row.sender_avatar_file_id ? `/api/files/${encodeURIComponent(row.sender_avatar_file_id)}` : null,
      body: row.deleted_at ? null : row.body,
      gifUrl: row.deleted_at ? null : row.gif_url,
      createdAt: row.created_at,
      editedAt: row.edited_at,
      deleted: Boolean(row.deleted_at),
      file: row.file_id ? {
        id: row.file_id,
        name: row.file_name,
        contentType: row.content_type,
        size: row.byte_size,
        url: `/api/files/${encodeURIComponent(row.file_id)}`,
      } : null,
    })),
  });
}

async function postMessage(request, env, conversationId, user) {
  const conversation = await requireConversationMember(env, conversationId, user.id);
  if (conversation.kind === "dm") {
    const peer = await env.DB.prepare(
      "SELECT user_id FROM conversation_members WHERE conversation_id = ? AND user_id <> ? AND left_at IS NULL",
    ).bind(conversationId, user.id).first();
    if (!peer || !await areFriends(env, user.id, peer.user_id)) {
      fail(403, "You can only send messages while you are friends.");
    }
  }
  const body = await readJson(request);
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const gifUrl = body.gifUrl ? validateGifUrl(body.gifUrl) : null;
  const fileId = body.fileId ? validateString(body.fileId, "File", 1, 80) : null;
  if ((!text && !gifUrl && !fileId) || text.length > 4000) {
    fail(400, "A message must contain text, a GIF, or an attachment.");
  }
  if (text && (gifUrl || fileId)) {
    fail(400, "Send text, a GIF, or an attachment separately.");
  }
  if (fileId) {
    const file = await env.DB.prepare(
      "SELECT id FROM files WHERE id = ? AND owner_id = ? AND purpose = 'message' AND conversation_id = ?",
    ).bind(fileId, user.id, conversationId).first();
    if (!file) {
      fail(403, "This attachment cannot be used in this conversation.");
    }
  }

  const id = crypto.randomUUID();
  const now = nowSeconds();
  await env.DB.prepare(`
    INSERT INTO messages (id, conversation_id, sender_id, body, gif_url, file_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, conversationId, user.id, text || null, gifUrl, fileId, now).run();

  const message = {
    id,
    conversationId,
    senderId: user.id,
    senderUsername: user.username,
    senderName: user.display_name,
    senderAvatarColor: user.avatar_color,
    senderAvatarUrl: user.avatar_file_id ? `/api/files/${encodeURIComponent(user.avatar_file_id)}` : null,
    body: text || null,
    gifUrl,
    fileId,
    createdAt: now,
  };
  const realtime = await dispatchRealtime(env, conversationId, { type: "message", message });
  return json({ message, realtime }, 201);
}

function validateGifUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    fail(400, "Enter a valid GIPHY URL.");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(400, "Enter a valid GIPHY URL.");
  }
  const host = url.hostname.toLowerCase();
  const isMediaHost = ["media.giphy.com", "i.giphy.com"].includes(host)
    || /^media\d+\.giphy\.com$/.test(host);
  if (url.protocol !== "https:" || (!isMediaHost && !["giphy.com", "www.giphy.com"].includes(host))) {
    fail(400, "Only HTTPS GIPHY URLs are supported.");
  }
  return url.href;
}

async function createInvite(request, env, conversationId, user) {
  await requireGroupOwner(env, conversationId, user.id);
  const now = nowSeconds();
  await env.DB.prepare("DELETE FROM group_invites WHERE expires_at <= ?").bind(now).run();
  const existingCodes = await env.DB.prepare("SELECT code FROM group_invites").all();
  const codes = new Set((existingCodes.results || []).map((entry) => entry.code));
  const random = new Uint32Array(1);
  let code;
  do {
    crypto.getRandomValues(random);
    code = String(random[0] % 100000000).padStart(8, "0");
  } while (codes.has(code));
  const expiresAt = now + 24 * 60 * 60;
  await env.DB.prepare(
    "INSERT INTO group_invites (code, conversation_id, created_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(code, conversationId, user.id, expiresAt, now).run();
  return json({ code, expiresAt }, 201);
}

async function joinByInvite(request, env, user) {
  const body = await readJson(request);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!/^\d{8}$/.test(code)) {
    fail(400, "Enter an 8-digit numeric invite code.");
  }
  const invite = await env.DB.prepare(`
    SELECT code, conversation_id FROM group_invites
    WHERE code = ? AND expires_at > ?
  `).bind(code, nowSeconds()).first();
  if (!invite) {
    fail(404, "This invite code is invalid or has expired.");
  }
  const group = await env.DB.prepare(
    "SELECT id, kind FROM conversations WHERE id = ? AND kind = 'group'",
  ).bind(invite.conversation_id).first();
  if (!group) {
    fail(404, "This invite code is invalid or has expired.");
  }
  const ban = await env.DB.prepare(
    "SELECT 1 FROM group_bans WHERE conversation_id = ? AND user_id = ?",
  ).bind(group.id, user.id).first();
  if (ban) {
    fail(403, "You are banned from this group.");
  }
  const existing = await env.DB.prepare(
    "SELECT left_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?",
  ).bind(group.id, user.id).first();
  if (existing && existing.left_at === null) {
    fail(409, "You are already a member of this group.");
  }
  const now = nowSeconds();
  await env.DB.prepare(`
    INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, left_at, last_read_at)
    VALUES (?, ?, 'member', ?, NULL, ?)
    ON CONFLICT(conversation_id, user_id)
    DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL, last_read_at = excluded.last_read_at
  `).bind(group.id, user.id, now, now).run();
  return json({ conversationId: group.id });
}

async function manageMessage(request, env, messageId, user) {
  const message = await env.DB.prepare(`
    SELECT m.id, m.conversation_id, m.sender_id, m.deleted_at, c.owner_id, c.kind
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE m.id = ?
  `).bind(messageId).first();
  if (!message) {
    fail(404, "Message not found.");
  }
  if (message.deleted_at) {
    fail(410, "This message has already been deleted.");
  }
  await requireConversationMember(env, message.conversation_id, user.id);
  const ownerCanDelete = request.method === "DELETE"
    && message.kind === "group"
    && message.owner_id === user.id;
  if (message.sender_id !== user.id && !ownerCanDelete) {
    fail(403, "You can only edit or delete your own messages.");
  }

  if (request.method === "PATCH") {
    if (message.sender_id !== user.id) {
      fail(403, "You can only edit your own messages.");
    }
    const body = await readJson(request);
    const text = validateString(body.body, "Message", 1, 4000);
    const now = nowSeconds();
    await env.DB.prepare(
      "UPDATE messages SET body = ?, gif_url = NULL, edited_at = ? WHERE id = ? AND deleted_at IS NULL",
    ).bind(text, now, messageId).run();
    const realtime = await dispatchRealtime(env, message.conversation_id, {
      type: "message-update",
      actorId: user.id,
      message: { id: messageId, body: text, editedAt: now },
    });
    return json({ ok: true, editedAt: now, realtime });
  }

  if (request.method === "DELETE") {
    const now = nowSeconds();
    const file = await env.DB.prepare("SELECT id, object_key FROM files WHERE id = (SELECT file_id FROM messages WHERE id = ?)")
      .bind(messageId).first();
    if (file && !env.BUCKET) {
      fail(503, "File storage is not configured.");
    }
    await env.DB.prepare("UPDATE messages SET body = NULL, gif_url = NULL, file_id = NULL, deleted_at = ? WHERE id = ?")
      .bind(now, messageId).run();
    if (file) {
      await env.BUCKET.delete(file.object_key);
      await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(file.id).run();
    }
    const realtime = await dispatchRealtime(env, message.conversation_id, {
      type: "message-delete",
      actorId: user.id,
      message: { id: messageId, deletedAt: now },
    });
    return json({ ok: true, realtime });
  }
  fail(405, "Method not allowed.");
}

async function handleFileUpload(request, env, user, purpose, conversationId = null) {
  let form;
  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > maximumUploadBytes + 1024 * 1024) {
      fail(413, "File is too large.");
    }
    form = await request.formData();
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    fail(400, "Invalid upload form.");
  }
  return saveUploadedFile(form.get("file"), env, user, purpose, conversationId);
}

async function saveUploadedFile(file, env, user, purpose, conversationId = null) {
  if (!(file instanceof File) || file.size < 1 || file.size > maximumUploadBytes) {
    fail(413, "Choose a file up to 15 MB.");
  }
  if (!allowedFileTypes.has(file.type.toLowerCase())) {
    fail(415, "This file type is not supported.");
  }
  if ((purpose === "profile" || purpose === "group-icon") && !file.type.startsWith("image/")) {
    fail(415, "Profile and group pictures must be images.");
  }
  if (purpose === "message") {
    await requireConversationMember(env, conversationId, user.id);
  } else if (purpose === "group-icon") {
    await requireGroupOwner(env, conversationId, user.id);
  }
  if (!env.BUCKET) {
    fail(503, "File storage is not configured.");
  }

  const id = crypto.randomUUID();
  const objectKey = `uploads/${user.id}/${id}`;
  const now = nowSeconds();
  const fileName = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 180) || "attachment";
  await env.BUCKET.put(objectKey, file.stream(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { ownerId: user.id, fileId: id },
  });
  try {
    await env.DB.prepare(`
      INSERT INTO files (id, owner_id, purpose, conversation_id, object_key, file_name, content_type, byte_size, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(id, user.id, purpose, conversationId, objectKey, fileName, file.type, file.size, now).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }

  if (purpose === "profile") {
    const previous = await env.DB.prepare(
      "SELECT f.id, f.object_key FROM profiles p JOIN files f ON f.id = p.avatar_file_id WHERE p.user_id = ?",
    ).bind(user.id).first();
    await env.DB.prepare(
      "UPDATE profiles SET avatar_file_id = ?, updated_at = ? WHERE user_id = ?",
    ).bind(id, now, user.id).run();
    if (previous) {
      await env.BUCKET.delete(previous.object_key);
      await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(previous.id).run();
    }
  } else if (purpose === "group-icon") {
    const previous = await env.DB.prepare(
      "SELECT f.id, f.object_key FROM conversations c JOIN files f ON f.id = c.icon_file_id WHERE c.id = ?",
    ).bind(conversationId).first();
    await env.DB.prepare(
      "UPDATE conversations SET icon_file_id = ? WHERE id = ?",
    ).bind(id, conversationId).run();
    if (previous) {
      await env.BUCKET.delete(previous.object_key);
      await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(previous.id).run();
    }
  }
  return json({
    file: { id, name: fileName, contentType: file.type, size: file.size, url: `/api/files/${id}` },
  }, 201);
}

async function getFile(request, env, user, fileId) {
  const file = await env.DB.prepare(`
    SELECT id, owner_id, purpose, conversation_id, object_key, file_name, content_type, byte_size
    FROM files WHERE id = ?
  `).bind(fileId).first();
  if (!file) {
    fail(404, "File not found.");
  }
  if (file.purpose === "message" || file.purpose === "group-icon") {
    if (!file.conversation_id) {
      fail(404, "File not found.");
    }
    await requireConversationMember(env, file.conversation_id, user.id);
  }
  const object = await env.BUCKET.get(file.object_key);
  if (!object) {
    fail(404, "File not found.");
  }
  const safeName = file.file_name.replace(/["\\\r\n]/g, "_");
  return new Response(object.body, {
    headers: {
      "content-type": file.content_type,
      "content-length": String(file.byte_size),
      "content-disposition": `inline; filename="${safeName}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

async function profileRoute(request, env, user, method) {
  if (method === "GET") {
    return json({ profile: userView(user) });
  }
  if (method === "PATCH") {
    const body = await readJson(request);
    const displayName = validateString(body.displayName, "Display name", 1, 40);
    const bio = typeof body.bio === "string" ? body.bio.trim() : "";
    if (bio.length > 200) {
      fail(400, "About me must be 200 characters or fewer.");
    }
    const avatarColor = typeof body.avatarColor === "string" ? body.avatarColor : user.avatar_color;
    if (!/^#[0-9a-f]{6}$/i.test(avatarColor)) {
      fail(400, "Choose a valid avatar color.");
    }
    await env.DB.prepare(
      "UPDATE profiles SET display_name = ?, bio = ?, avatar_color = ?, updated_at = ? WHERE user_id = ?",
    ).bind(displayName, bio, avatarColor, nowSeconds(), user.id).run();
    const profile = await env.DB.prepare(`
      SELECT u.id, u.username, p.display_name, p.bio, p.avatar_color, p.avatar_file_id
      FROM users u JOIN profiles p ON p.user_id = u.id WHERE u.id = ?
    `).bind(user.id).first();
    return json({ profile: userView(profile) });
  }
  fail(405, "Method not allowed.");
}

async function friendSearch(env, user, query) {
  const term = query.trim();
  if (term.length < 2 || term.length > 40) {
    fail(400, "Search with 2 to 40 characters.");
  }
  const result = await env.DB.prepare(`
    SELECT u.id, u.username, p.display_name, p.bio, p.avatar_color, p.avatar_file_id
    FROM users u
    JOIN profiles p ON p.user_id = u.id
    LEFT JOIN user_settings s ON s.user_id = u.id
    WHERE u.id <> ? AND COALESCE(s.discoverable, 1) = 1
      AND (u.username LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\')
      AND NOT EXISTS (
        SELECT 1 FROM friendships f
        WHERE (f.user_low = ? AND f.user_high = u.id) OR (f.user_high = ? AND f.user_low = u.id)
      )
    ORDER BY u.username LIMIT 20
  `).bind(user.id, `%${term.replace(/[%_\\]/g, "\\$&")}%`, `%${term.replace(/[%_\\]/g, "\\$&")}%`, user.id, user.id).all();
  return json({ users: (result.results || []).map(userView) });
}

async function settingsRoute(request, env, user) {
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT show_online_status, discoverable, reduce_motion FROM user_settings WHERE user_id = ?",
    ).bind(user.id).first();
    return json({
      settings: {
        showOnlineStatus: row?.show_online_status !== 0,
        discoverable: row?.discoverable !== 0,
        reduceMotion: row?.reduce_motion === 1,
      },
    });
  }
  if (request.method === "PATCH") {
    const body = await readJson(request);
    const keys = ["showOnlineStatus", "discoverable", "reduceMotion"];
    if (keys.some((key) => typeof body[key] !== "boolean")) {
      fail(400, "Provide all settings as true or false.");
    }
    await env.DB.prepare(`
      INSERT INTO user_settings (
        user_id, show_online_status, discoverable, reduce_motion, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        show_online_status = excluded.show_online_status,
        discoverable = excluded.discoverable,
        reduce_motion = excluded.reduce_motion,
        updated_at = excluded.updated_at
    `).bind(
      user.id,
      Number(body.showOnlineStatus),
      Number(body.discoverable),
      Number(body.reduceMotion),
      nowSeconds(),
    ).run();
    return json({ ok: true });
  }
  fail(405, "Method not allowed.");
}

async function friendsRoute(env, user) {
  const result = await env.DB.prepare(`
    SELECT u.id, u.username, p.display_name, p.bio, p.avatar_color, p.avatar_file_id
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.user_low = ? THEN f.user_high ELSE f.user_low END
    JOIN profiles p ON p.user_id = u.id
    WHERE f.user_low = ? OR f.user_high = ?
    ORDER BY p.display_name COLLATE NOCASE
  `).bind(user.id, user.id, user.id).all();
  return json({ friends: (result.results || []).map(userView) });
}

async function publicProfileRoute(env, user, userId) {
  const profile = await env.DB.prepare(`
    SELECT u.id, u.username, p.display_name, p.bio, p.avatar_color, p.avatar_file_id
    FROM users u JOIN profiles p ON p.user_id = u.id
    WHERE u.id = ?
  `).bind(userId).first();
  if (!profile) {
    fail(404, "Profile not found.");
  }
  if (userId !== user.id) {
    const friend = await areFriends(env, user.id, userId);
    const sharedGroup = await env.DB.prepare(`
      SELECT 1
      FROM conversations c
      JOIN conversation_members viewer
        ON viewer.conversation_id = c.id AND viewer.user_id = ? AND viewer.left_at IS NULL
      JOIN conversation_members subject
        ON subject.conversation_id = c.id AND subject.user_id = ? AND subject.left_at IS NULL
      WHERE c.kind = 'group'
      LIMIT 1
    `).bind(user.id, userId).first();
    if (!friend && !sharedGroup) {
      fail(404, "Profile not found.");
    }
  }
  return json({ profile: userView(profile) });
}

async function friendRequestsRoute(request, env, user, method) {
  if (method === "GET") {
    const result = await env.DB.prepare(`
      SELECT r.id, r.requester_id, r.recipient_id, r.status, r.created_at,
        u.username, p.display_name, p.avatar_color, p.avatar_file_id
      FROM friend_requests r
      JOIN users u ON u.id = CASE WHEN r.requester_id = ? THEN r.recipient_id ELSE r.requester_id END
      JOIN profiles p ON p.user_id = u.id
      WHERE (r.recipient_id = ? OR r.requester_id = ?) AND r.status = 'pending'
      ORDER BY r.created_at DESC
    `).bind(user.id, user.id, user.id).all();
    return json({
      requests: (result.results || []).map((row) => ({
        id: row.id,
        direction: row.recipient_id === user.id ? "incoming" : "outgoing",
        createdAt: row.created_at,
        user: userView(row),
      })),
    });
  }

  if (method === "POST") {
    const body = await readJson(request);
    const username = validateUsername(body.username);
    const target = await env.DB.prepare(`
      SELECT u.id, COALESCE(s.discoverable, 1) AS discoverable
      FROM users u LEFT JOIN user_settings s ON s.user_id = u.id
      WHERE u.username = ? COLLATE NOCASE
    `)
      .bind(username).first();
    if (!target || target.id === user.id || !target.discoverable) {
      fail(404, "User not found.");
    }
    if (await areFriends(env, user.id, target.id)) {
      fail(409, "You are already friends.");
    }
    const inverse = await env.DB.prepare(`
      SELECT id FROM friend_requests
      WHERE requester_id = ? AND recipient_id = ? AND status = 'pending'
    `).bind(target.id, user.id).first();
    if (inverse) {
      fail(409, "This user has already sent you a request.");
    }
    const duplicate = await env.DB.prepare(`
      SELECT id FROM friend_requests WHERE requester_id = ? AND recipient_id = ?
    `).bind(user.id, target.id).first();
    const now = nowSeconds();
    const requestId = duplicate?.id || crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO friend_requests (id, requester_id, recipient_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?)
      ON CONFLICT(requester_id, recipient_id)
      DO UPDATE SET status = 'pending', updated_at = excluded.updated_at
    `).bind(requestId, user.id, target.id, now, now).run();
    return json({ requestId }, 201);
  }

  fail(405, "Method not allowed.");
}

async function updateFriendRequest(request, env, user, requestId) {
  const body = await readJson(request);
  if (!["accept", "decline", "cancel"].includes(body.action)) {
    fail(400, "Choose accept, decline, or cancel.");
  }
  const row = await env.DB.prepare(
    "SELECT id, requester_id, recipient_id FROM friend_requests WHERE id = ? AND status = 'pending'",
  ).bind(requestId).first();
  if (!row) {
    fail(404, "Friend request not found.");
  }
  const now = nowSeconds();
  if (body.action === "accept" || body.action === "decline") {
    if (row.recipient_id !== user.id) {
      fail(403, "Only the recipient can answer this request.");
    }
    if (body.action === "accept") {
      const [low, high] = [row.requester_id, row.recipient_id].sort();
      await env.DB.batch([
        env.DB.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?")
          .bind(now, requestId),
        env.DB.prepare("INSERT OR IGNORE INTO friendships (user_low, user_high, created_at) VALUES (?, ?, ?)")
          .bind(low, high, now),
      ]);
    } else {
      await env.DB.prepare("UPDATE friend_requests SET status = 'declined', updated_at = ? WHERE id = ?")
        .bind(now, requestId).run();
    }
  } else {
    if (row.requester_id !== user.id) {
      fail(403, "Only the sender can cancel this request.");
    }
    await env.DB.prepare("UPDATE friend_requests SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .bind(now, requestId).run();
  }
  return json({ ok: true });
}

async function removeFriend(env, user, otherUserId) {
  const [low, high] = [user.id, otherUserId].sort();
  const result = await env.DB.prepare("DELETE FROM friendships WHERE user_low = ? AND user_high = ?")
    .bind(low, high).run();
  if (!result.meta?.changes) {
    fail(404, "Friend not found.");
  }
  return json({ ok: true });
}

async function conversationMembers(env, conversationId, user) {
  const conversation = await requireConversationMember(env, conversationId, user.id);
  const result = await env.DB.prepare(`
    SELECT u.id, u.username, p.display_name, p.avatar_color, p.avatar_file_id, cm.role
    FROM conversation_members cm
    JOIN users u ON u.id = cm.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE cm.conversation_id = ? AND cm.left_at IS NULL
    ORDER BY CASE cm.role WHEN 'owner' THEN 0 ELSE 1 END, p.display_name COLLATE NOCASE
  `).bind(conversationId).all();
  const bans = conversation.kind === "group" && conversation.owner_id === user.id
    ? await env.DB.prepare(`
      SELECT u.id, u.username, p.display_name
      FROM group_bans b JOIN users u ON u.id = b.user_id JOIN profiles p ON p.user_id = u.id
      WHERE b.conversation_id = ?
    `).bind(conversationId).all()
    : { results: [] };
  return json({
    members: (result.results || []).map((row) => ({ ...userView(row), role: row.role })),
    banned: (bans.results || []).map((row) => userView(row)),
    ownerId: conversation.owner_id,
  });
}

async function addGroupMember(request, env, conversationId, user) {
  await requireGroupOwner(env, conversationId, user.id);
  const body = await readJson(request);
  const memberId = validateString(body.userId, "User", 1, 80);
  if (memberId === user.id || !await areFriends(env, user.id, memberId)) {
    fail(400, "Invite one of your friends to this group.");
  }
  if (await env.DB.prepare(
    "SELECT 1 FROM group_bans WHERE conversation_id = ? AND user_id = ?",
  ).bind(conversationId, memberId).first()) {
    fail(403, "Unban this member before inviting them.");
  }
  const now = nowSeconds();
  await env.DB.prepare(`
    INSERT INTO conversation_members (conversation_id, user_id, role, joined_at, left_at, last_read_at)
    VALUES (?, ?, 'member', ?, NULL, ?)
    ON CONFLICT(conversation_id, user_id)
    DO UPDATE SET joined_at = excluded.joined_at, left_at = NULL
  `).bind(conversationId, memberId, now, now).run();
  return json({ ok: true }, 201);
}

async function removeGroupMember(env, conversationId, user, memberId) {
  const conversation = await requireConversationMember(env, conversationId, user.id);
  const isOwner = conversation.kind === "group" && conversation.owner_id === user.id;
  const isLeaving = memberId === user.id;
  if (!isOwner && !isLeaving) {
    fail(403, "Only the owner can remove another member.");
  }
  if (isOwner && isLeaving) {
    fail(409, "Transfer ownership before leaving the group.");
  }
  if (memberId === conversation.owner_id) {
    fail(400, "The group owner cannot be removed.");
  }
  const result = await env.DB.prepare(
    "UPDATE conversation_members SET left_at = ? WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL",
  ).bind(nowSeconds(), conversationId, memberId).run();
  if (!result.meta?.changes) {
    fail(404, "Group member not found.");
  }
  return json({ ok: true });
}

async function banGroupMember(env, conversationId, user, memberId, shouldBan) {
  await requireGroupOwner(env, conversationId, user.id);
  if (memberId === user.id) {
    fail(400, "The group owner cannot ban themselves.");
  }
  if (shouldBan) {
    const member = await env.DB.prepare(
      "SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ? AND left_at IS NULL",
    ).bind(conversationId, memberId).first();
    if (!member) {
      fail(404, "Active group member not found.");
    }
    const now = nowSeconds();
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO group_bans (conversation_id, user_id, banned_by, created_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(conversation_id, user_id) DO UPDATE SET banned_by = excluded.banned_by, created_at = excluded.created_at
      `).bind(conversationId, memberId, user.id, now),
      env.DB.prepare("UPDATE conversation_members SET left_at = ? WHERE conversation_id = ? AND user_id = ?")
        .bind(now, conversationId, memberId),
    ]);
  } else {
    const result = await env.DB.prepare("DELETE FROM group_bans WHERE conversation_id = ? AND user_id = ?")
      .bind(conversationId, memberId).run();
    if (!result.meta?.changes) {
      fail(404, "Banned member not found.");
    }
  }
  return json({ ok: true });
}

async function updateConversation(request, env, conversationId, user, method) {
  if (method === "PATCH") {
    await requireGroupOwner(env, conversationId, user.id);
    const body = await readJson(request);
    const name = validateString(body.name, "Group name", 1, 60);
    await env.DB.prepare("UPDATE conversations SET name = ? WHERE id = ?")
      .bind(name, conversationId).run();
    return json({ ok: true, name });
  }
  if (method === "DELETE") {
    await requireGroupOwner(env, conversationId, user.id);
    if (!env.BUCKET) {
      fail(503, "File storage is not configured.");
    }
    const files = await env.DB.prepare("SELECT object_key FROM files WHERE conversation_id = ?")
      .bind(conversationId).all();
    for (const file of files.results || []) {
      await env.BUCKET.delete(file.object_key);
    }
    await env.DB.prepare("DELETE FROM conversations WHERE id = ?")
      .bind(conversationId).run();
    return json({ ok: true });
  }
  fail(405, "Method not allowed.");
}

async function markConversationRead(env, conversationId, user) {
  await requireConversationMember(env, conversationId, user.id);
  await env.DB.prepare(
    "UPDATE conversation_members SET last_read_at = ? WHERE conversation_id = ? AND user_id = ?",
  ).bind(nowSeconds(), conversationId, user.id).run();
  return json({ ok: true });
}

async function realtimeRoute(request, env, user, url) {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    fail(426, "WebSocket upgrade required.");
  }
  if (!env.CHAT_ROOMS) {
    fail(503, "Realtime messaging is not configured.");
  }
  if (url.searchParams.get("presence") === "1") {
    const id = env.CHAT_ROOMS.idFromName("presence:global");
    const stub = env.CHAT_ROOMS.get(id);
    return stub.fetch(request);
  }
  const conversationId = validateString(url.searchParams.get("conversationId"), "Conversation", 1, 80);
  await requireConversationMember(env, conversationId, user.id);
  const id = env.CHAT_ROOMS.idFromName(`conversation:${conversationId}`);
  const stub = env.CHAT_ROOMS.get(id);
  return stub.fetch(request);
}

export async function handleApiRequest(request, env) {
  try {
    const url = new URL(request.url);
    verifySameOrigin(request);
    const parts = parsePath(url.pathname);
    if (parts[0] !== "api") {
      fail(404, "Not found.");
    }
    const method = request.method;

    if (parts[1] === "auth") {
      if (parts[2] === "signup" && method === "POST") {
        return await signUp(request, env);
      }
      if (parts[2] === "login" && method === "POST") {
        return await logIn(request, env);
      }
      if (parts[2] === "logout" && method === "POST") {
        return json({ ok: true }, 200, { "set-cookie": await removeSession(request, env) });
      }
      if (parts[2] === "me" && method === "GET") {
        return json({ user: userView(await requireUser(request, env)) });
      }
      fail(404, "Not found.");
    }

    const user = await requireUser(request, env);
    if (parts[1] === "account" && method === "DELETE") {
      if (!env.BUCKET) {
        fail(503, "File storage is not configured.");
      }
      const groups = await env.DB.prepare(
        "SELECT id FROM conversations WHERE kind = 'group' AND owner_id = ?",
      ).bind(user.id).all();
      for (const group of groups.results || []) {
        const successor = await env.DB.prepare(`
          SELECT user_id FROM conversation_members
          WHERE conversation_id = ? AND user_id <> ? AND left_at IS NULL
          ORDER BY joined_at, user_id LIMIT 1
        `).bind(group.id, user.id).first();
        if (successor) {
          await env.DB.batch([
            env.DB.prepare("UPDATE conversation_members SET role = 'member' WHERE conversation_id = ? AND role = 'owner'")
              .bind(group.id),
            env.DB.prepare("UPDATE conversation_members SET role = 'owner' WHERE conversation_id = ? AND user_id = ?")
              .bind(group.id, successor.user_id),
            env.DB.prepare("UPDATE conversations SET owner_id = ? WHERE id = ?")
              .bind(successor.user_id, group.id),
          ]);
        } else {
          const groupFiles = await env.DB.prepare(
            "SELECT object_key FROM files WHERE conversation_id = ?",
          ).bind(group.id).all();
          for (const file of groupFiles.results || []) {
            await env.BUCKET.delete(file.object_key);
          }
          await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(group.id).run();
        }
      }
      const files = await env.DB.prepare("SELECT object_key FROM files WHERE owner_id = ?").bind(user.id).all();
      for (const file of files.results || []) {
        await env.BUCKET.delete(file.object_key);
      }
      await env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id).run();
      return json({ ok: true }, 200, { "set-cookie": await removeSession(request, env) });
    }

    if (parts[1] === "profile") {
      if (parts[2] === "avatar" && method === "POST") {
        return await handleFileUpload(request, env, user, "profile");
      }
      if (parts[2] === "avatar" && method === "DELETE") {
        const previous = await env.DB.prepare(
          "SELECT f.id, f.object_key FROM profiles p JOIN files f ON f.id = p.avatar_file_id WHERE p.user_id = ?",
        ).bind(user.id).first();
        await env.DB.prepare("UPDATE profiles SET avatar_file_id = NULL, updated_at = ? WHERE user_id = ?")
          .bind(nowSeconds(), user.id).run();
        if (previous) {
          await env.BUCKET.delete(previous.object_key);
          await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(previous.id).run();
        }
        return json({ ok: true });
      }
      if (parts.length === 2) {
        return await profileRoute(request, env, user, method);
      }
    }
    if (parts[1] === "settings" && parts.length === 2) {
      return await settingsRoute(request, env, user);
    }
    if (parts[1] === "users" && parts[2] === "search" && method === "GET") {
      return await friendSearch(env, user, url.searchParams.get("q") || "");
    }
    if (parts[1] === "users" && parts.length === 4 && parts[3] === "profile" && method === "GET") {
      return await publicProfileRoute(env, user, parts[2]);
    }
    if (parts[1] === "friends" && parts.length === 2 && method === "GET") {
      return await friendsRoute(env, user);
    }
    if (parts[1] === "friends" && parts.length === 3 && method === "DELETE") {
      return await removeFriend(env, user, parts[2]);
    }
    if (parts[1] === "friend-requests") {
      if (parts.length === 2) {
        return await friendRequestsRoute(request, env, user, method);
      }
      if (parts.length === 3 && method === "PATCH") {
        return await updateFriendRequest(request, env, user, parts[2]);
      }
    }
    if (parts[1] === "conversations" && parts.length === 2) {
      if (method === "GET") {
        return json({ conversations: await conversationList(env, user) });
      }
      if (method === "POST") {
        return await createConversation(request, env, user);
      }
    }
    if (parts[1] === "invites" && parts[2] === "join" && method === "POST") {
      return await joinByInvite(request, env, user);
    }
    if (parts[1] === "conversations" && parts[2]) {
      const conversationId = parts[2];
      if (parts[3] === "messages") {
        if (method === "GET") {
          return await listMessages(env, conversationId, user, url);
        }
        if (method === "POST") {
          return await postMessage(request, env, conversationId, user);
        }
      }
      if (parts[3] === "members") {
        if (parts.length === 4 && method === "GET") {
          return await conversationMembers(env, conversationId, user);
        }
        if (parts.length === 4 && method === "POST") {
          return await addGroupMember(request, env, conversationId, user);
        }
        if (parts.length === 5 && method === "DELETE") {
          return await removeGroupMember(env, conversationId, user, parts[4]);
        }
      }
      if (parts[3] === "bans" && parts.length === 5) {
        if (method === "POST") {
          return await banGroupMember(env, conversationId, user, parts[4], true);
        }
        if (method === "DELETE") {
          return await banGroupMember(env, conversationId, user, parts[4], false);
        }
      }
      if (parts[3] === "invites" && method === "POST") {
        return await createInvite(request, env, conversationId, user);
      }
      if (parts[3] === "icon" && method === "POST") {
        return await handleFileUpload(request, env, user, "group-icon", conversationId);
      }
      if (parts[3] === "read" && method === "POST") {
        return await markConversationRead(env, conversationId, user);
      }
      if (parts.length === 3) {
        return await updateConversation(request, env, conversationId, user, method);
      }
    }
    if (parts[1] === "messages" && parts[2]) {
      return await manageMessage(request, env, parts[2], user);
    }
    if (parts[1] === "files") {
      if (parts.length === 2 && method === "POST") {
        const contentLength = Number(request.headers.get("content-length") || 0);
        if (contentLength > maximumUploadBytes + 1024 * 1024) {
          fail(413, "File is too large.");
        }
        let form;
        try {
          form = await request.formData();
        } catch {
          fail(400, "Invalid upload form.");
        }
        const conversationId = validateString(form.get("conversationId"), "Conversation", 1, 80);
        return await saveUploadedFile(form.get("file"), env, user, "message", conversationId);
      }
      if (parts.length === 3 && method === "GET") {
        return await getFile(request, env, user, parts[2]);
      }
    }
    if (parts[1] === "realtime" && method === "GET") {
      return await realtimeRoute(request, env, user, url);
    }
    fail(404, "Not found.");
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.message }, error.status);
    }
    console.error("Bandcast API request failed.", error);
    return json({ error: "The request could not be completed." }, 500);
  }
}
