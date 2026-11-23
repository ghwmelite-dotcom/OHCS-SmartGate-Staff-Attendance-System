CREATE TABLE IF NOT EXISTS notice_register (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 directorate_id TEXT REFERENCES directorates(id),
 reason TEXT NOT NULL,
 note TEXT,
 notice_date TEXT NOT NULL,
 expected_return_date TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,
 withdrawn_at TEXT,
 acknowledged_at TEXT,
 acknowledged_by TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_notice_register_scope ON notice_register(directorate_id, notice_date DESC, id);

CREATE INDEX IF NOT EXISTS idx_notice_register_owner ON notice_register(user_id, notice_date DESC, id);

CREATE TABLE IF NOT EXISTS notice_revisions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 notice_id TEXT NOT NULL REFERENCES notice_register(id),
 version INTEGER NOT NULL,
 event TEXT NOT NULL,
 actor_id TEXT REFERENCES users(id),
 reason TEXT NOT NULL,
 note TEXT,
 expected_return_date TEXT,
 at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_notice_revisions_notice ON notice_revisions(notice_id, id);

CREATE TRIGGER IF NOT EXISTS notice_register_insert AFTER INSERT ON absence_notices BEGIN INSERT INTO notice_register (id,user_id,directorate_id,reason,note,notice_date,expected_return_date,created_at,updated_at) VALUES (NEW.id,NEW.user_id,(SELECT directorate_id FROM users WHERE id=NEW.user_id),NEW.reason,NEW.note,NEW.notice_date,NEW.expected_return_date,NEW.created_at,NEW.created_at); INSERT INTO notice_revisions (notice_id,version,event,reason,note,expected_return_date) VALUES (NEW.id,1,'submitted',NEW.reason,NEW.note,NEW.expected_return_date); END;

CREATE TRIGGER IF NOT EXISTS notice_register_update AFTER UPDATE ON absence_notices WHEN OLD.reason IS NOT NEW.reason OR OLD.note IS NOT NEW.note OR OLD.expected_return_date IS NOT NEW.expected_return_date BEGIN INSERT OR IGNORE INTO notice_register (id,user_id,directorate_id,reason,note,notice_date,expected_return_date,created_at,updated_at) VALUES (OLD.id,OLD.user_id,(SELECT directorate_id FROM users WHERE id=OLD.user_id),OLD.reason,OLD.note,OLD.notice_date,OLD.expected_return_date,OLD.created_at,OLD.created_at); INSERT INTO notice_revisions (notice_id,version,event,reason,note,expected_return_date,at) SELECT id,version,'imported',reason,note,expected_return_date,created_at FROM notice_register n WHERE id=OLD.id AND NOT EXISTS (SELECT 1 FROM notice_revisions r WHERE r.notice_id=n.id); UPDATE notice_register SET reason=NEW.reason,note=NEW.note,expected_return_date=NEW.expected_return_date,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),acknowledged_at=NULL,acknowledged_by=NULL WHERE id=NEW.id; INSERT INTO notice_revisions (notice_id,version,event,reason,note,expected_return_date) SELECT id,version,'amended',reason,note,expected_return_date FROM notice_register WHERE id=NEW.id; END;

CREATE TRIGGER IF NOT EXISTS notice_register_withdraw AFTER DELETE ON absence_notices BEGIN INSERT OR IGNORE INTO notice_register (id,user_id,directorate_id,reason,note,notice_date,expected_return_date,created_at,updated_at) VALUES (OLD.id,OLD.user_id,(SELECT directorate_id FROM users WHERE id=OLD.user_id),OLD.reason,OLD.note,OLD.notice_date,OLD.expected_return_date,OLD.created_at,OLD.created_at); INSERT INTO notice_revisions (notice_id,version,event,reason,note,expected_return_date,at) SELECT id,version,'imported',reason,note,expected_return_date,created_at FROM notice_register n WHERE id=OLD.id AND NOT EXISTS (SELECT 1 FROM notice_revisions r WHERE r.notice_id=n.id); UPDATE notice_register SET withdrawn_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now'),version=version+1 WHERE id=OLD.id; INSERT INTO notice_revisions (notice_id,version,event,reason,note,expected_return_date) SELECT id,version,'withdrawn',reason,note,expected_return_date FROM notice_register WHERE id=OLD.id; END;

CREATE TRIGGER IF NOT EXISTS notice_register_ack AFTER UPDATE OF acknowledged_at ON notice_register WHEN NEW.acknowledged_at IS NOT NULL AND OLD.acknowledged_at IS NULL BEGIN INSERT INTO notice_revisions (notice_id,version,event,actor_id,reason,note,expected_return_date) VALUES (NEW.id,NEW.version,'acknowledged',NEW.acknowledged_by,NEW.reason,NEW.note,NEW.expected_return_date); END;


INSERT OR IGNORE INTO notice_register (id,user_id,directorate_id,reason,note,notice_date,expected_return_date,created_at,updated_at) SELECT a.id,a.user_id,u.directorate_id,a.reason,a.note,a.notice_date,a.expected_return_date,a.created_at,a.created_at FROM absence_notices a JOIN users u ON u.id=a.user_id;

INSERT INTO notice_revisions (notice_id,version,event,reason,note,expected_return_date,at) SELECT n.id,n.version,'imported',n.reason,n.note,n.expected_return_date,n.created_at FROM notice_register n WHERE NOT EXISTS (SELECT 1 FROM notice_revisions r WHERE r.notice_id=n.id);
