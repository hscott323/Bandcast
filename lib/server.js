const textEncoder = new TextEncoder();
const sessionCookieName = "bandcast_session";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

export function fail(status, message) {
  throw new ApiError(status, message);
}

export async function readJson(request, maxBytes = 32_000) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    fail(415, "Send a JSON request body.");
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    fail(413, "Request body is too large.");
  }

  let value;
  try {
    value = await request.json();
  } catch {
    fail(400, "Invalid JSON request body.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(400, "Request body must be a JSON object.");
  }
  return value;
}

export function validateString(value, label, minLength, maxLength) {
  if (typeof value !== "string") {
    fail(400, `${label} is required.`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    fail(400, `${label} must be between ${minLength} and ${maxLength} characters.`);
  }
  return normalized;
}

export function getCookie(request, name) {
  const cookieHeader = request.headers.get("cookie") || "";
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0 || pair.slice(0, separator).trim() !== name) {
      continue;
    }
    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function sessionCookie(request, token, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export async function digestHex(value) {
  const hash = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const passwordIterations = 100_000;
export const legacyPasswordIterations = 210_000;

export async function hashPassword(password, saltHex, iterations = passwordIterations) {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) || [], (byte) => parseInt(byte, 16));
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const result = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    salt,
    iterations,
    hash: "SHA-256",
  }, key, 256);
  return Array.from(new Uint8Array(result), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function getUser(request, env) {
  const token = getCookie(request, sessionCookieName);
  if (!token || token.length > 200) {
    return null;
  }
  const tokenHash = await digestHex(token);
  return env.DB.prepare(`
    SELECT u.id, u.username, p.display_name, p.bio, p.avatar_color, p.avatar_file_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    JOIN profiles p ON p.user_id = u.id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
}

export async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) {
    fail(401, "Sign in to continue.");
  }
  return user;
}

export function verifySameOrigin(request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    return;
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    fail(403, "Cross-origin requests are not allowed.");
  }
}

export async function checkAuthRateLimit(request, env) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM auth_attempts WHERE attempted_at <= ?")
    .bind(now - 24 * 60 * 60)
    .run();
  const address = request.headers.get("CF-Connecting-IP") || "unknown";
  const ipHash = await digestHex(address);
  const cutoff = now - 900;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM auth_attempts WHERE ip_hash = ? AND attempted_at > ?",
  ).bind(ipHash, cutoff).first();
  await env.DB.prepare(
    "INSERT INTO auth_attempts (ip_hash, attempted_at) VALUES (?, ?)",
  ).bind(ipHash, now).run();
  if ((row?.count || 0) >= 10) {
    fail(429, "Too many sign-in attempts. Try again in 15 minutes.");
  }
}

export async function createSession(request, env, userId) {
  const token = randomHex(32);
  const tokenHash = await digestHex(token);
  const now = Math.floor(Date.now() / 1000);
  const lifetime = 60 * 60 * 24 * 30;
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), userId, tokenHash, now + lifetime, now).run();
  return sessionCookie(request, token, lifetime);
}

export async function removeSession(request, env) {
  const token = getCookie(request, sessionCookieName);
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await digestHex(token))
      .run();
  }
  return sessionCookie(request, "", 0);
}

export async function requireConversationMember(env, conversationId, userId) {
  const row = await env.DB.prepare(`
    SELECT c.id, c.kind, c.owner_id, cm.role
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = ? AND cm.user_id = ? AND cm.left_at IS NULL
  `).bind(conversationId, userId).first();
  if (!row) {
    fail(404, "Conversation not found.");
  }
  if (row.kind === "group") {
    const ban = await env.DB.prepare(
      "SELECT 1 FROM group_bans WHERE conversation_id = ? AND user_id = ?",
    ).bind(conversationId, userId).first();
    if (ban) {
      fail(403, "You are banned from this group.");
    }
  }
  return row;
}

export async function requireGroupOwner(env, conversationId, userId) {
  const conversation = await requireConversationMember(env, conversationId, userId);
  if (conversation.kind !== "group" || conversation.owner_id !== userId) {
    fail(403, "Only the group owner can do this.");
  }
  return conversation;
}

export async function areFriends(env, firstUserId, secondUserId) {
  const [userLow, userHigh] = [firstUserId, secondUserId].sort();
  return Boolean(await env.DB.prepare(
    "SELECT 1 FROM friendships WHERE user_low = ? AND user_high = ?",
  ).bind(userLow, userHigh).first());
}

export async function dispatchRealtime(env, conversationId, event) {
  if (!env.CHAT_ROOMS) {
    return false;
  }
  try {
    const id = env.CHAT_ROOMS.idFromName(`conversation:${conversationId}`);
    const room = env.CHAT_ROOMS.get(id);
    const response = await room.fetch("https://chat-room/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...event, conversationId }),
    });
    if (!response.ok) {
      throw new Error(`Realtime worker returned ${response.status}.`);
    }
    return true;
  } catch (error) {
    console.error("Could not broadcast a persisted chat event.", error);
    return false;
  }
}
