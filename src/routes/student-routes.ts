import { Router } from "express";
import { getMyEarnings, studentLogin, getMe, getMyClients, studentSignup, getPayouts, requestPayout, updatePayoutMethods, updateProfile, changePassword, getLeaderboard, getRecentActivity } from "../controllers/student-controller";
import { getUserNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "../controllers/notification-controller";
import { studentAuth } from "../middleware/studentAuth";


const router = Router();

router.post("/signup-student", studentSignup);
router.post("/login-student", studentLogin);
router.get("/me/earnings", studentAuth, getMyEarnings);
router.get("/me/payouts", studentAuth, getPayouts);
router.post("/me/payouts/request", studentAuth, requestPayout);
router.get("/me", studentAuth, getMe);
router.put("/me/payout-methods", studentAuth, updatePayoutMethods);
router.get("/leaderboard", studentAuth, getLeaderboard);
router.get("/me/clients", studentAuth, getMyClients);
router.get("/me/activity", studentAuth, getRecentActivity);
router.put("/me/profile", studentAuth, updateProfile);
router.put("/me/password", studentAuth, changePassword);
router.get("/me/notifications", studentAuth, getUserNotifications);
router.put("/me/notifications/:id/read", studentAuth, markNotificationAsRead);
router.put("/me/notifications/read-all", studentAuth, markAllNotificationsAsRead);

export default router;
