require("dotenv").config();

/*
 * config/env validates every required variable and throws at require time, so
 * a misconfigured deployment fails here — at boot, with a clear message —
 * instead of on the first login attempt.
 */
const config = require("./src/config/env");
const app = require("./src/app");
const connectToDB = require("./src/config/database");
const mongoose = require("mongoose");

async function start() {
  /*
   * Connect BEFORE listening. Accepting traffic without a database only turns
   * one clear startup error into a stream of confusing request failures.
   */
  await connectToDB();

  const server = app.listen(config.port, () => {
    console.log(
      `Server is running on port ${config.port} (${config.nodeEnv} mode)`,
    );
  });

  /* Finish in-flight requests, then close the database, then exit. */
  const shutdown = (signal) => {
    console.log(`\n[server] ${signal} received, shutting down`);

    server.close(async () => {
      await mongoose.connection.close(false);
      process.exit(0);
    });

    /* Do not hang forever on a stuck connection. */
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((err) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});

/*
 * A promise rejection that nothing handles leaves the process in an unknown
 * state. Log it loudly and exit so the platform restarts a clean instance.
 */
process.on("unhandledRejection", (reason) => {
  console.error("[server] unhandled rejection:", reason);
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  console.error("[server] uncaught exception:", err);
  process.exit(1);
});
