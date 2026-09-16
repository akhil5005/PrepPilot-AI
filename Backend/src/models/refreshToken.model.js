const mongoose = require("mongoose");

/**
 * One document per active login session (one per refresh token).
 *
 * The raw refresh token is never stored. We store only its `jti` plus a SHA-256
 * hash of the token string, which lets us:
 *
 *   - revoke a single session without touching the others,
 *   - rotate the token on every refresh, and
 *   - detect *reuse* of an already rotated token, which is the standard signal
 *     that a refresh token was stolen. When that happens the whole session
 *     family is killed (see token.service.js).
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    jti: {
      type: String,
      required: true,
      unique: true,
    },

    /* SHA-256 of the signed token, so a DB leak cannot be replayed. */
    tokenHash: {
      type: String,
      required: true,
    },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
      index: true,
    },

    /*
     * All tokens descended from a single login share a family id. Rotation
     * keeps the family; reuse detection revokes the entire family at once.
     */
    family: {
      type: String,
      required: true,
      index: true,
    },

    revokedAt: {
      type: Date,
      default: null,
    },

    /* Set when this token was rotated, pointing at its replacement. */
    replacedBy: {
      type: String,
      default: null,
    },

    userAgent: {
      type: String,
      default: null,
    },

    ip: {
      type: String,
      default: null,
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

/* Expired sessions are cleaned up automatically by MongoDB. */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const refreshTokenModel = mongoose.model("refreshTokens", refreshTokenSchema);

module.exports = refreshTokenModel;
