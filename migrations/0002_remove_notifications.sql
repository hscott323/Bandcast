DROP TABLE IF EXISTS notifications;

CREATE TABLE user_settings_new (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_online_status INTEGER NOT NULL DEFAULT 1 CHECK (show_online_status IN (0, 1)),
  discoverable INTEGER NOT NULL DEFAULT 1 CHECK (discoverable IN (0, 1)),
  reduce_motion INTEGER NOT NULL DEFAULT 0 CHECK (reduce_motion IN (0, 1)),
  updated_at INTEGER NOT NULL
);

INSERT INTO user_settings_new (user_id, show_online_status, discoverable, reduce_motion, updated_at)
SELECT user_id, show_online_status, discoverable, reduce_motion, updated_at
FROM user_settings;

DROP TABLE user_settings;

ALTER TABLE user_settings_new RENAME TO user_settings;
