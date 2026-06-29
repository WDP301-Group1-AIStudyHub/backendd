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
  public static async getUsers(search?: string) {
    const query: Record<string, any> = {};
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
   * Update document status (e.g., ACTIVE, ARCHIVED, DELETED) and visibility
   */
  public static async updateDocumentStatus(
    documentId: string,
    updateData: { status?: "ACTIVE" | "ARCHIVED" | "DELETED"; visibility?: "PUBLIC" | "PRIVATE" }
  ) {
    const document = await StudyDocument.findByIdAndUpdate(
      documentId,
      { $set: updateData },
      { new: true, runValidators: true }
    );

    if (!document) {
      throw new Error("Document not found");
    }

    return document;
  }

  /**
   * Soft delete a document by admin
   */
  public static async deleteDocument(documentId: string) {
    const document = await StudyDocument.findByIdAndUpdate(
      documentId,
      {
        $set: {
          status: "DELETED",
          deletedAt: new Date(),
        },
      },
      { new: true }
    );

    if (!document) {
      throw new Error("Document not found");
    }

    return document;
  }
  /**
   * Update user role
   */
  public static async updateUserRole(userId: string, role: "user" | "admin") {
    const user = await User.findByIdAndUpdate(
      userId,
      { $set: { role } },
      { new: true, runValidators: true }
    );

    if (!user) {
      throw new Error("User not found");
    }

    return user;
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
