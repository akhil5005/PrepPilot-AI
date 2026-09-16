const mongoose = require("mongoose");

/**
 * Denylist of revoked ACCESS tokens.
 *
 * Two changes from the original design:
 *
 * 1. It stores the token's `jti` (a short random id embedded in the JWT) rather
 *    than the whole token. A stolen database dump therefore does not hand an
 *    attacker a set of bearer credentials, and the index stays small.
 *
 * 2. `expiresAt` carries a TTL index, so an entry is removed by MongoDB as soon
 *    as the token it refers to would have expired anyway. Without this the
 *    collection grows without bound and every authenticated request has to scan
 *    an ever larger set.
 */
const blacklistTokenSchema = new mongoose.Schema(
  {
    jti: {
      type: String,
      required: [true, "jti is required to blacklist a token"],
      unique: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },

    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

/* MongoDB deletes the document once `expiresAt` passes. */
blacklistTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const tokenBlacklistModel = mongoose.model(
  "blacklistTokens",
  blacklistTokenSchema,
);

module.exports = tokenBlacklistModel;
