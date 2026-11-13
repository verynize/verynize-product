-- Default covers render the first page; custom covers keep their selected node reference.
-- Rebuild rather than edit migration 0010 so existing custom cover rows remain intact.
CREATE TABLE room_thumbnail_next (
  roomId TEXT PRIMARY KEY NOT NULL,
  assetId TEXT NOT NULL REFERENCES room_asset(id),
  nodeId TEXT,
  pageId TEXT,
  updatedAt INTEGER NOT NULL,
  CHECK (nodeId IS NOT NULL OR pageId IS NOT NULL)
);
INSERT INTO room_thumbnail_next (roomId, assetId, nodeId, pageId, updatedAt)
SELECT roomId, assetId, nodeId, NULL, updatedAt FROM room_thumbnail;
DROP TABLE room_thumbnail;
ALTER TABLE room_thumbnail_next RENAME TO room_thumbnail;
