import { Request, Response } from "express";
import prisma from "../lib/prisma";
import bcrypt from "bcryptjs";
import { signClientToken } from "../utils/jwt";

export const registerClient = async (req: Request, res: Response) => {
  console.log("REGISTER CLIENT REQUEST BODY:", req.body);
  /* 
    Update registerClient to:
    1. Accept password
    2. Hash password
    3. Create client with password & status=pending
    4. Return token
  */
  const {
    business_name,
    business_type,
    phone,
    email,
    password, // NEW
    referral_code,
  } = req.body;

  if (
    !business_name ||
    !business_type ||
    !phone ||
    !email ||
    !password || // NEW
    !referral_code
  ) {
    return res.status(400).json({
      error: "Missing required fields",
    });
  }

  try {
    const student = await prisma.student.findUnique({
      where: { referralCode: referral_code },
    });

    if (!student) {
      return res.status(404).json({
        error: "Invalid referral code",
      });
    }

    // Check if client exists
    const existingClient = await prisma.client.findFirst({
      where: { OR: [{ email }, { phone }] }
    });
    if (existingClient) {
      return res.status(400).json({ error: "Client already registered with this email or phone" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          businessName: business_name,
          businessType: business_type,
          phone,
          email,
          password: hashedPassword,
          status: 'pending',
          studentId: student.id,
        },
      });

      const lead = await tx.leadsPipeline.create({
        data: {
          clientId: client.id,
          studentId: student.id,
          status: "pending",
          commissionRate: student.commissionPercent, // Snapshot the rate at creation!
        }
      });

      return { client, lead };
    });

    // Generate token
    const token = signClientToken(result.client.id);

    return res.status(201).json({
      message: "Client registered successfully",
      token,
      client: {
        id: result.client.id,
        email: result.client.email,
        status: result.client.status
      }
    });
  } catch (err: any) {
    console.error(err);
    return res.status(500).json({
      error: "Internal server error: " + err.message,
    });
  }
};

export const loginClient = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email and password required" });

    const client = await prisma.client.findUnique({ where: { email } });
    if (!client || !(await bcrypt.compare(password, client.password))) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signClientToken(client.id);
    res.json({
      token,
      client: {
        id: client.id,
        email: client.email,
        status: client.status,
        businessName: client.businessName
      }
    });

  } catch (err) {
    console.error("Client login error:", err);

    res.status(500).json({ error: "Login failed" });
  }
};

export const validateReferralCode = async (req: Request, res: Response) => {
  const { code } = req.params;
  const referralCode = Array.isArray(code) ? code[0] : code;

  if (!referralCode) {
    return res.status(400).json({ valid: false, message: "Referral code required" });
  }

  try {
    const student = await prisma.student.findUnique({
      where: { referralCode: referralCode },
      select: { name: true }
    });

    if (!student) {
      return res.status(404).json({ valid: false, message: "Invalid referral code" });
    }

    return res.json({ valid: true, name: student.name });
  } catch (err) {
    console.error("Error validating referral code:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
};
