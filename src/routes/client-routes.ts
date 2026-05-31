import { Router } from "express";
import { registerClient, loginClient, validateReferralCode } from "../controllers/client-controller";

const router = Router();

router.post("/register-client", registerClient);
router.post("/login-client", loginClient);
router.get("/check-referral/:code", validateReferralCode);

export default router;
