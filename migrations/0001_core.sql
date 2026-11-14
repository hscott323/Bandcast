PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#5865f2',
  avatar_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_online_status INTEGER NOT NULL DEFAULT 1 CHECK (show_online_status IN (0, 1)),
  discoverable INTEGER NOT NULL DEFAULT 1 CHECK (discoverable IN (0, 1)),
  desktop_notifications INTEGER NOT NULL DEFAULT 1 CHECK (desktop_notifications IN (0, 1)),
  reduce_motion INTEGER NOT NULL DEFAULT 0 CHECK (reduce_motion IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE auth_attempts (
  ip_hash TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX auth_attempts_ip_time_idx ON auth_attempts(ip_hash, attempted_at);

CREATE TABLE friend_requests (
  id TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (requester_id <> recipient_id),
  UNIQUE (requester_id, recipient_id)
);
CREATE INDEX friend_requests_recipient_status_idx ON friend_requests(recipient_id, status, created_at);
CREATE INDEX friend_requests_requester_status_idx ON friend_requests(requester_id, status, created_at);

CREATE TABLE friendships (
  user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);
CREATE INDEX friendships_high_idx ON friendships(user_high, user_low);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('dm', 'group')),
  dm_pair_key TEXT UNIQUE,
  name TEXT,
  icon_file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  CHECK ((kind = 'dm' AND dm_pair_key IS NOT NULL AND owner_id IS NULL)
      OR (kind = 'group' AND dm_pair_key IS NULL))
);
CREATE INDEX conversations_owner_idx ON conversations(owner_id, created_at);

CREATE TABLE conversation_members (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_active_idx ON conversation_members(user_id, left_at, conversation_id);

CREATE TABLE group_bans (
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  banned_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE TABLE group_invites (
  code TEXT PRIMARY KEY CHECK (length(code) = 8 AND code NOT GLOB '*[^0-9]*'),
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX group_invites_conversation_idx ON group_invites(conversation_id, expires_at);
CREATE INDEX group_invites_expiry_idx ON group_invites(expires_at);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('profile', 'group-icon', 'message')),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  created_at INTEGER NOT NULL,
  CHECK ((purpose = 'message' AND conversation_id IS NOT NULL)
      OR (purpose <> 'message'))
);
CREATE INDEX files_owner_idx ON files(owner_id, created_at);
CREATE INDEX files_conversation_idx ON files(conversation_id, created_at);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT,
  gif_url TEXT,
  file_id TEXT REFERENCES files(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  CHECK (body IS NULL OR length(body) <= 4000),
  CHECK (gif_url IS NULL OR length(gif_url) <= 2048),
  CHECK ((body IS NOT NULL AND length(body) > 0)
      OR gif_url IS NOT NULL
      OR file_id IS NOT NULL
      OR deleted_at IS NOT NULL)
);
CREATE INDEX messages_conversation_time_idx ON messages(conversation_id, created_at DESC, id);
CREATE INDEX messages_sender_time_idx ON messages(sender_id, created_at DESC);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('friend-request', 'message', 'group-invite')),
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  friend_request_id TEXT REFERENCES friend_requests(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  CHECK ((kind = 'friend-request' AND friend_request_id IS NOT NULL)
      OR (kind = 'message' AND message_id IS NOT NULL)
      OR (kind = 'group-invite' AND conversation_id IS NOT NULL))
);
CREATE INDEX notifications_user_unread_idx ON notifications(user_id, read_at, created_at DESC);
