const mongoose = require("mongoose");
const config = require("./env");

/**
 * @description Connect to MongoDB.
 *
 * The previous version swallowed connection errors, so the process would
 * happily start listening with no database behind it and every request would
 * then hang or fail in a confusing way. Failing loudly here is far easier to
 * diagnose, and lets the hosting platform restart the instance.
 */
async function connectToDB() {
  /* Reject writes that reference fields not present in the schema. */
  mongoose.set("strictQuery", true);

  mongoose.connection.on("error", (err) => {
    console.error("[db] connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[db] disconnected");
  });

  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 10000,
  });

  console.log("Connected to database");

  /*
   * Build the unique / TTL indexes declared on the models. Mongoose does this
   * automatically in development, but autoIndex is usually disabled in
   * production; calling it explicitly means the uniqueness guarantees and the
   * token cleanup TTLs actually exist wherever this runs.
   */
  try {
    await Promise.all([
      require("../models/user.model").syncIndexes(),
      require("../models/blacklist.model").syncIndexes(),
      require("../models/refreshToken.model").syncIndexes(),
    ]);
  } catch (err) {
    /*
     * A failure here usually means existing data violates a new unique index
     * (for example two accounts whose emails differ only by case). Surface it
     * clearly but do not take the server down over it.
     */
    console.error("[db] index sync failed:", err.message);
  }
}

module.exports = connectToDB;
