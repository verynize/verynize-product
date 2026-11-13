-- One mutable R2 object at rooms/<roomId>/thumbnail, independent of room assets.
CREATE TABLE room_thumbnail (
  roomId TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  contentType TEXT NOT NULL,
  size INTEGER NOT NULL,
  nodeId TEXT,
  pageId TEXT,
  updatedAt INTEGER NOT NULL,
  CHECK (nodeId IS NOT NULL OR pageId IS NOT NULL)
);
