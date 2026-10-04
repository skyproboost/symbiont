// src/gardener/lessons.ts
function zoneOf(file) {
  const norm = file.replaceAll("\\", "/");
  const i = norm.lastIndexOf("/");
  return i === -1 ? "(корень)" : norm.slice(0, i);
}
function ensureLessons(db) {
  db.run(`CREATE TABLE IF NOT EXISTS lessons(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      zone TEXT NOT NULL,
      statement TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(zone, statement)
    )`);
}
function recordLesson(db, zone, statement, source, now) {
  ensureLessons(db);
  db.query("INSERT INTO lessons(zone, statement, source, created_at) VALUES(?,?,?,?) ON CONFLICT(zone, statement) DO UPDATE SET created_at=excluded.created_at, source=excluded.source").run(zone, statement, source, now);
}
function lessonsForZones(db, zones, limit) {
  if (zones.length === 0)
    return [];
  const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='lessons'").get().n > 0;
  if (!has)
    return [];
  const uniq = [...new Set(zones)];
  const placeholders = uniq.map(() => "?").join(",");
  return db.query(`SELECT zone, statement, source, created_at FROM lessons WHERE zone IN (${placeholders}) ORDER BY created_at DESC LIMIT ?`).all(...uniq, limit);
}
function countLessons(db) {
  try {
    const has = db.query("SELECT COUNT(*) n FROM sqlite_master WHERE type='table' AND name='lessons'").get().n > 0;
    return has ? db.query("SELECT COUNT(*) n FROM lessons").get().n : 0;
  } catch {
    return 0;
  }
}

export { zoneOf, recordLesson, lessonsForZones, countLessons };
