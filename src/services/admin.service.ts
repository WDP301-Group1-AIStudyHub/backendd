import { User } from "../models/user.model";
import { StudyDocument } from "../modules/documents/document.model";
import { ActivityLog } from "../models/activityLog.model";
import { ChatThread } from "../models/chatThread.model";
import { StudyMaterial } from "../models/studyMaterial.model";
import mongoose from "mongoose";

export class AdminService {
  /**
   * Get paginated users for admin management
   */
  public static async getUsers(search?: string, currentUser?: { id: string; role: string }) {
    const query: Record<string, any> = {};

    if (currentUser) {
      query._id = { $ne: currentUser.id };
      query.role = { $ne: currentUser.role };
    }
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .lean();

    return {
      users,
      total: users.length,
    };
  }

  /**
   * Get paginated documents for oversight
   */
  public static async getDocuments(search?: string) {
    const query: Record<string, any> = {};
    if (search) {
      query.title = { $regex: search, $options: "i" };
    }

    const documents = await StudyDocument.find(query)
      .sort({ createdAt: -1 })
      .populate("ownerId", "fullName email")
      .lean();

    return {
      documents,
      total: documents.length,
    };
  }

  /**
   * Get system-wide statistics for the admin dashboard (FE-25)
   */
  public static async getDashboardStats() {
    const [
      totalUsers,
      totalDocuments,
      totalChatThreads,
      totalStudyMaterials,
      recentActivities,
      extractionStats
    ] = await Promise.all([
      User.countDocuments(),
      StudyDocument.countDocuments(),
      ChatThread.countDocuments(),
      StudyMaterial.countDocuments(),
      ActivityLog.find().sort({ createdAt: -1 }).limit(10).populate("userId", "fullName email").lean(),
      StudyDocument.aggregate([
        {
          $group: {
            _id: null,
            totalChunks: { $sum: "$totalChunks" },
            successfulExtractions: {
              $sum: { $cond: [{ $eq: ["$extractionStatus", "COMPLETED"] }, 1, 0] },
            },
            failedExtractions: {
              $sum: { $cond: [{ $eq: ["$extractionStatus", "FAILED"] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const extStats = extractionStats[0] || {
      totalChunks: 0,
      successfulExtractions: 0,
      failedExtractions: 0,
    };

    // Evaluate platform health based on extraction failure rate and DB connection
    const totalExtractions = extStats.successfulExtractions + extStats.failedExtractions;
    const failureRate = totalExtractions > 0 ? (extStats.failedExtractions / totalExtractions) * 100 : 0;
    const isDbConnected = mongoose.connection.readyState === 1;

    let overallHealth = "Healthy";
    if (!isDbConnected) overallHealth = "Critical";
    else if (failureRate > 10) overallHealth = "Warning (High Extraction Failure)";

    return {
      usageStatistics: {
        totalUsers,
        totalDocuments,
        totalChatThreads,
        totalStudyMaterials,
      },
      platformHealth: {
        status: overallHealth,
        databaseConnected: isDbConnected,
        documentProcessing: {
          totalChunksProcessed: extStats.totalChunks,
          completedExtractions: extStats.successfulExtractions,
          failedExtractions: extStats.failedExtractions,
          failureRatePercentage: failureRate.toFixed(2),
        }
      },
      recentActivities,
    };
  }


  /**
   * Ban a user account
   */
  public static async banUser(userId: string, reason: string) {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { isActive: false, banReason: reason } },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }

  /**
   * Unban a user account
   */
  public static async unbanUser(userId: string) {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { isActive: true, banReason: "" } },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error("User not found");
    }

    return user;
  }
}
