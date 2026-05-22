import { User } from "../models/user.model";
import { IUser } from "../../../types/user.type";

// Get all users
export const getAllUsersService = async () => {
  try {
    const users = await User.find().select("-password");
    return users;
  } catch (error) {
    throw new Error("Error fetching users");
  }
};

// Get user by ID
export const getUserByIdService = async (userId: string) => {
  try {
    const user = await User.findById(userId).select("-password");
    if (!user) {
      throw new Error("User not found");
    }
    return user;
  } catch (error) {
    throw error;
  }
};

// Update user
export const updateUserService = async (
  userId: string,
  updateData: Partial<IUser>,
) => {
  try {
    // Remove sensitive fields that shouldn't be updated through this endpoint
    const { password, isAdmin, googleId, ...safeUpdateData } =
      updateData as any;

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: safeUpdateData },
      { new: true, runValidators: true },
    ).select("-password");

    if (!user) {
      throw new Error("User not found");
    }
    return user;
  } catch (error) {
    throw error;
  }
};
