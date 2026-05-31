import { Router } from "express";
import {
  adminLogin,
  getLeads,
  updateLeadStatus,
  markLeadAsPaid,
  completePartialPayment,
  settlePayout,
  getAllUsers,
  getAllCommissions,
  getUserDetails,
  getPayouts,
  bulkSettlePayouts,
  getAuditLogs,
  getEntityAuditLogs,
  createManualPayout,
  getClients,
  getLedger,
  updateUserStatus
} from "../controllers/admin-controller";
import {
  createNotification,
  getAllNotifications,
  deleteNotification,
  deleteNotificationsByTitle
} from "../controllers/notification-controller";
import { adminAuth } from "../middleware/adminAuth";

const router = Router();

router.post("/login", adminLogin);
router.get("/users", adminAuth, getAllUsers);
router.get("/users/:id", adminAuth, getUserDetails); // Added
router.patch("/users/:id/status", adminAuth, updateUserStatus); // New route for banning/unbanning
router.get("/clients", adminAuth, getClients);
router.get("/commissions", adminAuth, getAllCommissions);
router.get("/payouts", adminAuth, getPayouts);
router.get("/leads", adminAuth, getLeads);
router.patch("/leads/:id/status", adminAuth, updateLeadStatus);
router.post(
  "/leads/:id/mark-paid",
  adminAuth,
  markLeadAsPaid
);
router.post(
  "/leads/:id/complete-partial",
  adminAuth,
  completePartialPayment
);
router.post(
  "/payouts/:id/settle",
  adminAuth,
  settlePayout
);
router.post(
  "/payouts/bulk-settle",
  adminAuth,
  bulkSettlePayouts
);
router.post(
  "/payouts/manual",
  adminAuth,
  createManualPayout
);

// Ledger Routes
router.get("/ledger", adminAuth, getLedger);

// Audit log routes
router.get("/audit-logs", adminAuth, getAuditLogs);
router.get("/audit-logs/:entityType/:entityId", adminAuth, getEntityAuditLogs);

// Notification routes
router.post("/notifications", adminAuth, createNotification);
router.get("/notifications", adminAuth, getAllNotifications);
router.delete("/notifications/:id", adminAuth, deleteNotification);
router.post("/notifications/delete-by-title", adminAuth, deleteNotificationsByTitle);

export default router;
