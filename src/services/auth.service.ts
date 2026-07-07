import { User, IUser } from "../models/user.model";
import {
  AuthResponse,
  RegisterRequest,
  UpdateProfileRequest,
  UserResponse,
} from "../types/api.types";
import { generateAccessToken } from "../utils/generateToken";
import { AppError } from "../middlewares/error.middleware";
import {
  claimDocumentShareInvitations,
  validateDocumentShareInvitation,
} from "../modules/documentShares/documentShareInvitation.service";

export const toUserResponse = (user: IUser): UserResponse & { isActive?: boolean; banReason?: string } => ({
  id: user._id.toString(),
  fullName: user.fullName,
  email: user.email,
  avatar: user.avatar,
  role: user.role,
  isActive: user.isActive,
  banReason: user.banReason,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export const registerUser = async (
  payload: RegisterRequest,
): Promise<AuthResponse> => {
  const existingUser = await User.findOne({ email: payload.email });

  if (existingUser) {
    throw new AppError("Email is already registered", 409);
  }

  if (payload.inviteToken) {
    await validateDocumentShareInvitation(payload.email, payload.inviteToken);
  }

  const { inviteToken, ...userPayload } = payload;
  const user = await User.create(userPayload);
  const accessToken = generateAccessToken(user);
  const redirectDocumentId = inviteToken
    ? await claimDocumentShareInvitations(
        user.email,
        user._id.toString(),
        inviteToken,
      )
    : undefined;

  return {
    user: toUserResponse(user),
    accessToken,
    redirectDocumentId,
  };
};

export const loginUser = async (
  email: string,
  password: string,
): Promise<AuthResponse> => {
  const user = await User.findOne({ email }).select("+password");

  if (!user || !(await user.comparePassword(password))) {
    throw new AppError("Invalid email or password", 401);
  }

  if (user.isActive === false) {
    throw new AppError(`Your account has been banned. Reason: ${user.banReason || 'Contact support'}`, 401);
  }

  const accessToken = generateAccessToken(user);

  return {
    user: toUserResponse(user),
    accessToken,
  };
};

export const getUserById = async (userId: string): Promise<UserResponse> => {
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return toUserResponse(user);
};

export const updateUserProfile = async (
  userId: string,
  payload: UpdateProfileRequest,
): Promise<UserResponse> => {
  const user = await User.findByIdAndUpdate(userId, payload, {
    new: true,
    runValidators: true,
  });

  if (!user) {
    throw new AppError("User not found", 404);
  }

  return toUserResponse(user);
};
