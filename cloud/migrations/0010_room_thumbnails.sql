-- A rendered file cover references an existing room asset, never binary document data.
CREATE TABLE room_thumbnail (
  roomId TEXT PRIMARY KEY NOT NULL,
  assetId TEXT NOT NULL REFERENCES room_asset(id),
  nodeId TEXT NOT NULL,
  updatedAt INTEGER NOT NULL
);
