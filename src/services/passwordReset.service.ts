import { randomBytes, createHash } from "node:crypto";
import { User } from "../models/user.model";
import { PasswordResetToken } from "../models/passwordResetToken.model";
import { AppError } from "../middlewares/error.middleware";
import { sendPasswordResetEmail } from "./email.service";
import {
  buildMobilePasswordResetUrl,
  buildWebPasswordResetUrl,
} from "./publicAppUrl.service";

const RESET_TTL_MINUTES = 60;

const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * Always resolves the same way whether or not the email exists — the
 * response to the caller must never leak whether an account was found.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  const normalizedEmail = email.trim().toLowerCase();
  const user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    return;
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

  await PasswordResetToken.findOneAndUpdate(
    { userId: user._id },
    { tokenHash: hashToken(token), expiresAt },
    { upsert: true },
  );

  await sendPasswordResetEmail({
    to: user.email,
    recipientName: user.fullName,
    resetUrl: buildWebPasswordResetUrl(token, user.email),
    mobileResetUrl: buildMobilePasswordResetUrl(token, user.email),
  });
};

export const resetPassword = async (
  token: string,
  newPassword: string,
): Promise<void> => {
  const record = await PasswordResetToken.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });

  if (!record) {
    throw new AppError("Invalid or expired reset token", 400, "PASSWORD_RESET_TOKEN_INVALID");
  }

  const user = await User.findById(record.userId);
  if (!user) {
    throw new AppError("Invalid or expired reset token", 400, "PASSWORD_RESET_TOKEN_INVALID");
  }

  // Assigning + .save() (not updateOne) so the pre("save") bcrypt hook on
  // User actually runs — a raw updateOne would store the password in plaintext.
  user.password = newPassword;
  await user.save();

  await PasswordResetToken.deleteOne({ _id: record._id });
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> => {
  const user = await User.findById(userId).select("+password");

  if (!user || !(await user.comparePassword(currentPassword))) {
    throw new AppError("Current password is incorrect", 400, "CURRENT_PASSWORD_INCORRECT");
  }

  user.password = newPassword;
  await user.save();
};
