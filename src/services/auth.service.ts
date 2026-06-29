import { User, IUser } from "../models/user.model";
import {
  AuthResponse,
  RegisterRequest,
  UpdateProfileRequest,
  UserResponse,
} from "../types/api.types";
import { generateAccessToken } from "../utils/generateToken";
import { AppError } from "../middlewares/error.middleware";

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

  const user = await User.create(payload);
  const accessToken = generateAccessToken(user);

  return {
    user: toUserResponse(user),
    accessToken,
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
    throw new AppError(`Your account has been banned. Reason: ${user.banReason || 'Contact support'}`, 403);
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
