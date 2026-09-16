/*
 * Regression test for the lockout introduced when emails began being
 * normalised to lowercase.
 *
 * An account created by the OLD code could be stored as "Akhil@Gmail.com".
 * The new validator lowercases the submitted address, so an exact-match lookup
 * could never find that document and the user was permanently locked out of
 * their own account. This test inserts such a legacy document directly (bypassing
 * the schema's lowercase setter) and proves login works and self-heals.
 */
process.env.MONGO_URI = "mongodb://127.0.0.1:27017/genaiapp_legacytest";
process.env.JWT_SECRET = "t".repeat(48);
process.env.JWT_REFRESH_SECRET = "r".repeat(48);
process.env.NODE_ENV = "development";
process.env.FRONTEND_URL = "http://localhost:5173";
process.env.BCRYPT_ROUNDS = "10";

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const app = require("../src/app");
const connectToDB = require("../src/config/database");
const userModel = require("../src/models/user.model");

let pass = 0,
  fail = 0;
function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}`, extra === undefined ? "" : extra);
  }
}

(async () => {
  await connectToDB();
  await mongoose.connection.dropDatabase();

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function post(path, body) {
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json };
  }

  /*
   * Insert through the raw driver so the schema's lowercase setter does NOT
   * run — this reproduces exactly what the old code left in the database.
   */
  const LEGACY_EMAIL = "Akhil@Gmail.COM";
  const PASSWORD = "Str0ngPass1";

  await mongoose.connection.collection("users").insertOne({
    username: "AkhilLegacy",
    email: LEGACY_EMAIL,
    password: await bcrypt.hash(PASSWORD, 10),
    tokenVersion: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const stored = await mongoose.connection
    .collection("users")
    .findOne({ username: "AkhilLegacy" });
  check("legacy account stored with capitals", stored.email === LEGACY_EMAIL, stored.email);

  console.log("\n-- the bug --");
  let r = await post("/api/auth/login", {
    email: "akhil@gmail.com",
    password: PASSWORD,
  });
  check("legacy user can log in with lowercase email", r.status === 200, r.body);

  console.log("\n-- self-healing --");
  const healed = await mongoose.connection
    .collection("users")
    .findOne({ username: "AkhilLegacy" });
  check(
    "stored email normalised to lowercase after login",
    healed.email === "akhil@gmail.com",
    healed.email,
  );

  r = await post("/api/auth/login", {
    email: "AKHIL@GMAIL.COM",
    password: PASSWORD,
  });
  check("still works from any capitalisation afterwards", r.status === 200, r.body);

  console.log("\n-- no regressions --");
  r = await post("/api/auth/login", {
    email: "akhil@gmail.com",
    password: "WrongPassword1",
  });
  check("wrong password still rejected", r.status === 401, r.body);

  r = await post("/api/auth/register", {
    username: "someoneelse",
    email: "akhil@gmail.com",
    password: "Str0ngPass1",
  });
  check("cannot register a duplicate of a legacy email", r.status === 409, r.body);

  /* Re-insert a legacy-cased doc to prove the register guard catches it too. */
  await mongoose.connection.collection("users").insertOne({
    username: "OtherLegacy",
    email: "Bob@Example.COM",
    password: await bcrypt.hash(PASSWORD, 10),
    tokenVersion: 0,
  });
  r = await post("/api/auth/register", {
    username: "bobclone",
    email: "bob@example.com",
    password: "Str0ngPass1",
  });
  check("register blocks a case-variant of an un-healed legacy email", r.status === 409, r.body);

  console.log(`\n==== ${pass} passed, ${fail} failed ====`);
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error("HARNESS ERROR", e);
  process.exit(1);
});
