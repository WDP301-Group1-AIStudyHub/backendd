import { Request, Response } from "express";
import { AdminService } from "../services/admin.service";
import { ActivityLogService } from "../services/activityLog.service";

export const getUsers = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;

    const data = await AdminService.getUsers(search);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error("Error in admin getUsers:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch users",
    });
  }
};

export const getDocuments = async (req: Request, res: Response) => {
  try {
    const search = req.query.search as string;

    const data = await AdminService.getDocuments(search);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error("Error in admin getDocuments:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch documents",
    });
  }
};

export const getActivityLogs = async (req: Request, res: Response) => {
  try {
    const action = req.query.action as string;
    const userId = req.query.userId as string;

    const data = await ActivityLogService.getLogs({ action, userId });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error("Error in admin getActivityLogs:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch activity logs",
    });
  }
};

export const getDashboardStats = async (req: Request, res: Response) => {
  try {
    const data = await AdminService.getDashboardStats();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error: any) {
    console.error("Error in admin getDashboardStats:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch dashboard stats",
    });
  }
};

export const updateDocumentStatus = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status, visibility } = req.body;

    const data = await AdminService.updateDocumentStatus(id, { status, visibility });

    await ActivityLogService.log({
      userId: req.authUser!.id,
      action: "OTHER", // Should ideally be DOCUMENT_UPDATE
      entityType: "Document",
      entityId: id,
      details: { action: "Admin updated document status/visibility", status, visibility },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Document status updated successfully",
      data,
    });
  } catch (error: any) {
    console.error("Error in admin updateDocumentStatus:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update document status",
    });
  }
};

export const deleteDocument = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    await AdminService.deleteDocument(id);

    await ActivityLogService.log({
      userId: req.authUser!.id,
      action: "DOCUMENT_DELETE",
      entityType: "Document",
      entityId: id,
      details: { action: "Admin soft deleted document" },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "Document deleted successfully",
    });
  } catch (error: any) {
    console.error("Error in admin deleteDocument:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete document",
    });
  }
};

export const updateUserRole = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { role } = req.body;

    const data = await AdminService.updateUserRole(id, role);

    await ActivityLogService.log({
      userId: req.authUser!.id,
      action: "OTHER",
      entityType: "User",
      entityId: id,
      details: { action: "Admin updated user role", role },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "User role updated successfully",
      data,
    });
  } catch (error: any) {
    console.error("Error in admin updateUserRole:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update user role",
    });
  }
};

export const banUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: "Ban reason is required" });
    }

    const data = await AdminService.banUser(id, reason);

    await ActivityLogService.log({
      userId: req.authUser!.id,
      action: "OTHER",
      entityType: "User",
      entityId: id,
      details: { action: "Admin banned user account", reason },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "User banned successfully",
      data,
    });
  } catch (error: any) {
    console.error("Error in admin banUser:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to ban user",
    });
  }
};

export const unbanUser = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const data = await AdminService.unbanUser(id);

    await ActivityLogService.log({
      userId: req.authUser!.id,
      action: "OTHER",
      entityType: "User",
      entityId: id,
      details: { action: "Admin unbanned user account" },
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(200).json({
      success: true,
      message: "User unbanned successfully",
      data,
    });
  } catch (error: any) {
    console.error("Error in admin unbanUser:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to unban user",
    });
  }
};
