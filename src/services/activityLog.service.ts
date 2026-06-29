import { Types } from "mongoose";
import { ActivityAction, ActivityLog, EntityType } from "../models/activityLog.model";

interface LogParams {
  userId?: string | Types.ObjectId;
  action: ActivityAction;
  entityType: EntityType;
  entityId?: string | Types.ObjectId;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export class ActivityLogService {
  /**
   * Log an activity to the database.
   * This is designed to be fire-and-forget, so it catches and logs its own errors
   * without disrupting the main application flow.
   */
  public static async log(params: LogParams): Promise<void> {
    try {
      const logEntry = new ActivityLog({
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        details: params.details,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      });
      await logEntry.save();
    } catch (error) {
      console.error("Failed to save activity log:", error);
    }
  }

  /**
   * Retrieve activity logs with pagination and optional filtering
   */
  public static async getLogs(
    filters: { action?: string; userId?: string } = {}
  ) {
    const query: Record<string, any> = {};
    if (filters.action) query.action = filters.action;
    if (filters.userId) query.userId = filters.userId;

    const logs = await ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .populate("userId", "fullName email role")
      .lean();

    return {
      logs,
      total: logs.length,
    };
  }
}
