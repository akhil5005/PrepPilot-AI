const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const config = require("../config/env");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters long"],
      maxlength: [30, "Username must be at most 30 characters long"],
    },

    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      trim: true,
      /*
       * Stored lowercase so that "User@Example.com" and "user@example.com"
       * cannot become two separate accounts, and so that login lookups match.
       */
      lowercase: true,
    },

    password: {
      type: String,
      required: [true, "Password is required"],
      /*
       * Never returned by a normal query. Any code that needs to verify a
       * password must ask for it explicitly with `.select("+password")`, which
       * makes accidental leaks through res.json impossible.
       */
      select: false,
    },

    /*
     * Incremented whenever every session for this user must be invalidated
     * (logout from all devices, password change, refresh token reuse detected).
     * Access tokens carry the version they were minted with, so bumping this
     * rejects every token already in the wild without touching a denylist.
     */
    tokenVersion: {
      type: Number,
      default: 0,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/*
 * Note on uniqueness: the `unique: true` options above create the indexes, and
 * those indexes — not the application level "does this already exist?" check in
 * the controller — are what actually guarantee uniqueness. Two simultaneous
 * registrations can both pass an application check before either one inserts;
 * only the database can arbitrate. The `lowercase: true` setter normalises
 * writes first, so the index also makes email uniqueness case insensitive.
 */

/**
 * Hash the password whenever it is set or changed, so no call site can ever
 * store a plaintext password by forgetting to hash it first.
 */
userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) {
    return;
  }

  this.password = await bcrypt.hash(this.password, config.bcryptRounds);
});

/**
 * @description Compare a plaintext candidate against the stored hash.
 * @param {string} candidatePassword
 * @returns {Promise<boolean>}
 */
userSchema.methods.comparePassword = function comparePassword(
  candidatePassword,
) {
  if (!this.password) {
    throw new Error(
      "Password field was not selected on this document; use .select('+password')",
    );
  }

  return bcrypt.compare(candidatePassword, this.password);
};

/**
 * @description Find a user by email, tolerating accounts that predate email
 * normalisation.
 *
 * New accounts are stored lowercase, so the exact match below handles them and
 * uses the unique index. But accounts created BEFORE emails were normalised may
 * be stored as "Akhil@Gmail.com", and since callers now pass a lowercased
 * address, an exact match would never find them — locking those users out of
 * their own accounts permanently.
 *
 * The fallback repeats the lookup with a case-insensitive collation
 * (`strength: 2` ignores case and accents). It only runs when the fast path
 * misses, so the common case stays indexed.
 *
 * @param {string} email An already-lowercased address.
 * @param {string} [select] Extra fields to select, e.g. "+password".
 * @returns {Promise<object|null>}
 */
userSchema.statics.findByEmail = async function findByEmail(email, select) {
  const exact = this.findOne({ email });

  if (select) {
    exact.select(select);
  }

  const found = await exact;

  if (found) {
    return found;
  }

  const legacy = this.findOne({ email }).collation({
    locale: "en",
    strength: 2,
  });

  if (select) {
    legacy.select(select);
  }

  return legacy;
};

/**
 * @description The public shape of a user, safe to return in any response.
 */
userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    username: this.username,
    email: this.email,
    createdAt: this.createdAt,
  };
};

/*
 * Defence in depth: even if a document is serialised directly, strip the
 * sensitive and internal fields.
 */
userSchema.set("toJSON", {
  transform(doc, ret) {
    delete ret.password;
    delete ret.tokenVersion;
    delete ret.__v;
    return ret;
  },
});

const userModel = mongoose.model("users", userSchema);

module.exports = userModel;
