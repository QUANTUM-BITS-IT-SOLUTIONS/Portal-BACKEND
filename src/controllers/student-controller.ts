import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { signStudentToken } from "../utils/jwt";
import bcrypt from "bcryptjs";
import { auditService } from "../utils/audit.service";


// Helper to generate a code
function generateReferralCode(name: string) {
  const base = name.trim().split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '');
  const random = Math.floor(Math.random() * 10000);
  return `${base}${random}`;
}

export async function studentSignup(req: Request, res: Response) {
  try {
    const { name, email, password, phoneNumber, universityName } = req.body;

    if (!name || !email || !password || !phoneNumber || !universityName) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const existing = await prisma.student.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "Email already registered" });
    }

    let referralCode = generateReferralCode(name);
    // basic collision check (could be improved with a loop)
    const existingCode = await prisma.student.findUnique({ where: { referralCode } });
    if (existingCode) {
      referralCode = generateReferralCode(name) + "x";
    }

    // Get the Bronze tier (default tier for new students)
    const bronzeTier = await prisma.partnerTier.findFirst({
      where: { name: "Bronze" }
    });

    const student = await prisma.student.create({
      data: {
        name,
        email,
        password: await bcrypt.hash(password, 10),
        phoneNumber,
        universityName,
        referralCode,
        commissionPercent: bronzeTier?.commissionPercentage ? Number(bronzeTier.commissionPercentage) : 5, // Use tier's commission
        partnerTierId: bronzeTier?.id || null, // Assign Bronze tier by default
        paymentMethod: null,
      }
    });

    // Audit log
    auditService.logAsync({
      userId: student.id,
      action: "STUDENT_SIGNUP",
      entityType: "Student",
      entityId: student.id,
      newValues: { email, name, universityName, referralCode },
      ipAddress: req.ip,
    });

    const token = signStudentToken(student.id);

    return res.json({
      token,
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
      }
    });

  } catch (err) {
    console.error("Student signup error:", err);
    res.status(500).json({ error: "Signup failed" });
  }
}

export async function studentLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const student = await prisma.student.findUnique({
      where: { email },
    });

    if (!student || !(await bcrypt.compare(password, student.password))) {
      // Audit failed login
      auditService.logAsync({
        userId: email,
        action: "LOGIN_FAILED",
        entityType: "Student",
        metadata: { email, reason: "Invalid credentials" },
        ipAddress: req.ip,
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (student.status !== "ACTIVE") {
      auditService.logAsync({
        userId: student.id,
        action: "LOGIN_FAILED",
        entityType: "Student",
        metadata: { email, reason: "Account not active", status: student.status },
        ipAddress: req.ip,
      });
      return res.status(403).json({ error: "Account is not active. Please contact support." });
    }

    const token = signStudentToken(student.id);

    return res.json({
      token,
      student: {
        id: student.id,
        name: student.name,
        email: student.email,
      },
    });
  } catch (err) {
    console.error("Student login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
}


export async function getMyEarnings(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;


    // Performance timer
    const start = Date.now();

    // Current month start (used for monthly earnings)
    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        1
      )
    );

    /*
     * Run all database queries in parallel
     * This is MUCH faster than running them one-by-one.
     */
    const [
      commissionAgg,
      monthlyAgg,
      totalPaidLeads,
      dealAgg,
      pendingLeads,
      withdrawnAgg,
      pendingRequestsAgg,
      monthlyBreakdown,
    ] = await Promise.all([

      // Lifetime commission earned
      prisma.ledgerEntry.aggregate({
        where: {
          studentId,
          type: "student_commission",
        },
        _sum: {
          amount: true,
        },
      }),

      // Current month commission earned
      prisma.ledgerEntry.aggregate({
        where: {
          studentId,
          type: "student_commission",
          createdAt: {
            gte: startOfMonth,
          },
        },
        _sum: {
          amount: true,
        },
      }),

      // Total successfully converted (paid) leads
      prisma.leadsPipeline.count({
        where: {
          studentId,
          status: "paid",
        },
      }),

      // Lifetime revenue generated by paid leads
      prisma.leadsPipeline.aggregate({
        where: {
          studentId,
          status: "paid",
        },
        _sum: {
          dealAmount: true,
        },
      }),

      // Leads still in the pipeline
      // Used to calculate potential future earnings
      prisma.leadsPipeline.findMany({
        where: {
          studentId,
          status: {
            in: [
              "pending",
              "payment_sent",
              "negotiating",
              "lead_added",
              "team_approval",
              "payment_link",
              "invoice",
              "client_pays",
            ],
          },
          commissionStatus: "pending",
        },
        select: {
          dealAmount: true,
          commissionRate: true,
        },
      }),

      // Total amount already paid to student
      prisma.studentPayout.aggregate({
        where: {
          studentId,
          status: "completed",
        },
        _sum: {
          amount: true,
        },
      }),

      // Withdrawal requests not completed yet
      prisma.studentPayout.aggregate({
        where: {
          studentId,
          status: {
            in: ["pending", "processing"],
          },
        },
        _sum: {
          amount: true,
        },
      }),

      // Monthly chart data
      getMonthlyBreakdown(studentId),
    ]);

    // Lifetime commission earned
    const totalCommissionEarned =
      Number(commissionAgg._sum.amount) || 0;

    // Current month earnings
    const currentMonthEarnings =
      Number(monthlyAgg._sum.amount) || 0;

    // Total client revenue generated
    const lifetimeDealValue =
      Number(dealAgg._sum.dealAmount) || 0;

    /*
     * Calculate potential future earnings
     * based on leads still moving through pipeline
     */
    const potentialEarnings = pendingLeads.reduce(
      (sum, lead) => {
        if (!lead.dealAmount) return sum;

        const rate =
          Number(lead.commissionRate || 5);

        return (
          sum +
          (Number(lead.dealAmount) * rate) / 100
        );
      },
      0
    );

    // Total money already withdrawn
    const totalWithdrawn =
      Number(withdrawnAgg._sum.amount) || 0;

    // Pending payout requests
    const totalRequestsPending =
      Number(pendingRequestsAgg._sum.amount) || 0;

    /*
     * Available balance:
     * Commission earned
     * - withdrawn payouts
     * - pending payout requests
     */
    const walletBalance =
      totalCommissionEarned -
      (totalWithdrawn + totalRequestsPending);

    // Performance log
    console.log(
      `getMyEarnings took ${Date.now() - start
      }ms`
    );

    return res.json({
      // Lifetime earnings
      total_commission_earned:
        totalCommissionEarned,

      // This month earnings
      current_month_earnings:
        currentMonthEarnings,

      // Number of converted clients
      total_paid_leads:
        totalPaidLeads,

      // Total revenue generated
      lifetime_deal_value:
        lifetimeDealValue,

      // Future potential earnings
      pending_amount:
        potentialEarnings,

      // Available withdrawal balance
      wallet_balance:
        walletBalance,

      // Already paid out
      total_withdrawn:
        totalWithdrawn,

      // Pending withdrawal requests
      total_requests_pending:
        totalRequestsPending,

      // Earnings chart
      monthly_breakdown:
        monthlyBreakdown,
    });


  } catch (error) {
    console.error(
      "Get Earnings Error:",
      error
    );

    return res.status(500).json({
      error: "Failed to fetch earnings",
    });

  }
}


async function getMonthlyBreakdown(studentId: string) {
  // Get last 6 months earnings
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1); // Start of that month


  // Group by "Month Year" in JS since Prisma groupBy date truncation is DB specific
  const monthlyMap = new Map<string, number>();

  // Initialize last 6 months with 0
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = d.toLocaleString('default', { month: 'short' });
    monthlyMap.set(key, 0);
  }

  // Populate actual data (Note: groupBy 'createdAt' returns raw timestamps, we need to map manually if not using raw query)
  // Actually groupBy createdAt is grouping by unique timestamp which is useless.
  // Better to fetch raw entries and aggregate in JS for small datasets, or use raw query.
  // Given low scale, findMany is fine.
  const rawEntries = await prisma.ledgerEntry.findMany({
    where: {
      studentId,
      type: "student_commission",
      createdAt: { gte: sixMonthsAgo }
    },
    select: { createdAt: true, amount: true }
  });

  rawEntries.forEach(entry => {
    const key = new Date(entry.createdAt).toLocaleString('default', { month: 'short' });
    if (monthlyMap.has(key)) {
      monthlyMap.set(key, (monthlyMap.get(key) || 0) + Number(entry.amount));
    }
  });

  return Array.from(monthlyMap.entries())
    .map(([month, total]) => ({ month, total }))
    .reverse(); // Show chronological
}

export async function getPayouts(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;
    console.log(`DEBUG: Fetching payouts for studentId: ${studentId}`);

    const payouts = await prisma.studentPayout.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' }
    });

    console.log(`DEBUG: Found ${payouts.length} payouts`);
    if (payouts.length > 0) {
      console.log('DEBUG: First payout sample:', JSON.stringify(payouts[0], null, 2));
    }

    res.json(payouts);
  } catch (err) {
    console.error("Get Payouts error:", err);
    res.status(500).json({ error: "Failed to fetch payouts" });
  }
}

export async function requestPayout(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;
    const { amount, paymentMethod, paymentDetails } = req.body;

    // Recalculate balance to verify
    const commissionAgg = await prisma.ledgerEntry.aggregate({
      where: { studentId, type: "student_commission" },
      _sum: { amount: true },
    });
    const totalEarned = Number(commissionAgg._sum.amount) || 0;

    const payoutsAgg = await prisma.studentPayout.aggregate({
      where: { studentId, status: { not: 'failed' } }, // Exclude failed
      _sum: { amount: true }
    });
    const totalPayouts = Number(payoutsAgg._sum.amount) || 0;

    const availableBalance = totalEarned - totalPayouts;

    const student = await prisma.student.findUnique({
      where: { id: studentId }
    });

    if (!student?.paymentMethod && !paymentMethod) {
      return res.status(400).json({ error: "No payment method set. Please configure in settings." });
    }

    if (amount > 10000) {
      if (!student?.panNumber || !student?.panVerified) {
        return res.status(400).json({ error: "PAN verification required for payouts > ₹10,000" });
      }
    }

    if (amount > availableBalance) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    if (amount < 1000) { // Minimum payout rule
      return res.status(400).json({ error: "Minimum payout amount is 1000" });
    }

    const payout = await prisma.studentPayout.create({
      data: {
        studentId,
        amount,
        status: 'pending',
        paymentMethod: paymentMethod || 'bank_transfer', // Default or from request
        paymentDetails: paymentDetails || {},
      }
    });

    // Audit log
    auditService.logAsync({
      userId: studentId,
      action: "REQUEST_PAYOUT",
      entityType: "StudentPayout",
      entityId: payout.id,
      newValues: { amount, paymentMethod, status: 'pending' },
      ipAddress: req.ip,
    });

    res.json(payout);
  } catch (err) {
    console.error("Request Payout error:", err);
    res.status(500).json({ error: "Failed to request payout" });
  }
}

export async function getMe(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: { partnerTier: true }
    });

    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }

    // Map Prisma model to match what the frontend might expect (optional but good for consistency)
    const profile = {
      id: student.id,
      user_id: student.id, // For compatibility
      first_name: student.name.split(" ")[0],
      last_name: student.name.split(" ").slice(1).join(" ") || "",
      email: student.email,
      university: student.universityName,
      referral_code: student.referralCode,
      referred_by: null, // Schema doesn't have self-referral tracking yet
      is_approved: true, // Assuming active students are approved
      // New fields
      commission_percent: Number(student.commissionPercent),
      tier_name: student.partnerTier?.name || "Standard",
      tier_icon: student.partnerTier?.icon || "Star",
      avatar_url: student.avatarUrl || null,

      // Contact Info
      phone_number: student.phoneNumber,

      // Payment & Tax Info
      payment_method: student.paymentMethod,
      upi_id: student.upiId,
      bank_account_number: student.bankAccountNumber,
      bank_ifsc: student.bankIfsc,
      pan_number: student.panNumber,
      pan_verified: student.panVerified,
    };

    res.json(profile);
  } catch (err) {
    console.error("Get Me error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
}

export async function getMyClients(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;


    const [clients, student] = await Promise.all([
      prisma.client.findMany({
        where: { studentId },
        include: {
          leads: {
            select: {
              status: true,
              dealAmount: true,
              commissionRate: true,
              createdAt: true,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),

      prisma.student.findUnique({
        where: { id: studentId },
        select: {
          commissionPercent: true,
          partnerTier: {
            select: {
              commissionPercentage: true,
            },
          },
        },
      }),
    ]);

    const defaultRate =
      student?.partnerTier?.commissionPercentage
        ? Number(student.partnerTier.commissionPercentage)
        : Number(student?.commissionPercent || 5);

    const transformedClients = clients.map((client) => {
      const lead = client.leads[0];

      const commissionRate = lead?.commissionRate
        ? Number(lead.commissionRate)
        : defaultRate;

      const dealAmount = Number(lead?.dealAmount || 0);

      return {
        ...client,
        calculated_earnings: Math.floor(
          (dealAmount * commissionRate) / 100
        ),
        deal_amount: dealAmount,
        payment_status: lead?.status || "pending",
        commission_percent: commissionRate,
      };
    });

    return res.json(transformedClients);


  } catch (error) {
    console.error("Get Clients Error:", error);


    return res.status(500).json({
      error: "Failed to fetch clients",
    });


  }
}


export async function updatePayoutMethods(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;
    const {
      paymentMethod,
      upiId,
      bankAccount,
      ifscCode,
      panNumber
    } = req.body;

    // Simple validation
    if (paymentMethod === 'upi' && !upiId) {
      return res.status(400).json({ error: "UPI ID is required" });
    }
    if (paymentMethod === 'bank' && (!bankAccount || !ifscCode)) {
      return res.status(400).json({ error: "Bank details are required" });
    }

    const data: any = {
      paymentMethod,
      upiId: paymentMethod === 'upi' ? upiId : null,
      bankAccountNumber: paymentMethod === 'bank' ? bankAccount : null,
      bankIfsc: paymentMethod === 'bank' ? ifscCode : null,
    };

    // If PAN is provided, update it and attempt verification
    if (panNumber) {
      const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
      if (!panRegex.test(panNumber)) {
        return res.status(400).json({ error: "Invalid PAN format" });
      }
      data.panNumber = panNumber;
      // In a real app, verify against an API here. 
      // For now, auto-verify if valid format
      data.panVerified = true;
    }

    const oldStudent = await prisma.student.findUnique({ where: { id: studentId } });

    const updated = await prisma.student.update({
      where: { id: studentId },
      data
    });

    // Audit log
    auditService.logAsync({
      userId: studentId,
      action: "UPDATE_PAYOUT_METHODS",
      entityType: "Student",
      entityId: studentId,
      oldValues: {
        paymentMethod: oldStudent?.paymentMethod,
        upiId: oldStudent?.upiId,
        bankAccountNumber: oldStudent?.bankAccountNumber,
        panNumber: oldStudent?.panNumber,
      },
      newValues: data,
      ipAddress: req.ip,
    });

    res.json({ success: true, student: updated });

  } catch (err) {
    console.error("Update Payout Methods error:", err);
    res.status(500).json({ error: "Failed to update payout methods" });
  }
}

export async function updateProfile(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;
    const { firstName, lastName, university } = req.body;

    if (!firstName || !lastName) {
      return res.status(400).json({ error: "First and last name are required" });
    }

    const fullName = `${firstName.trim()} ${lastName.trim()}`;

    const oldStudent = await prisma.student.findUnique({ where: { id: studentId } });

    const updated = await prisma.student.update({
      where: { id: studentId },
      data: {
        name: fullName,
        universityName: university || undefined,
      },
    });

    // Audit log
    auditService.logAsync({
      userId: studentId,
      action: "UPDATE_PROFILE",
      entityType: "Student",
      entityId: studentId,
      oldValues: { name: oldStudent?.name, universityName: oldStudent?.universityName },
      newValues: { name: fullName, universityName: university },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Update Profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function changePassword(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.student.update({
      where: { id: studentId },
      data: {
        password: hashedPassword,
      },
    });

    // Audit log (don't log actual password)
    auditService.logAsync({
      userId: studentId,
      action: "CHANGE_PASSWORD",
      entityType: "Student",
      entityId: studentId,
      metadata: { message: "Password changed successfully" },
      ipAddress: req.ip,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Change Password error:", err);
    res.status(500).json({ error: "Failed to update password" });
  }
}

export async function getLeaderboard(req: Request, res: Response) {
  try {
    const currentStudentId = (req as any).studentId;

    // 1. Get all students with their total earnings and ACTIVE LEADS count
    // Active leads = leads that are NOT 'paid' and NOT 'cancelled' (so pending, payment_sent, etc.)

    // Group ledger entries by student to get earnings
    const earningsByStudent = await prisma.ledgerEntry.groupBy({
      by: ['studentId'],
      where: {
        type: 'student_commission',
        studentId: { not: null }
      },
      _sum: {
        amount: true
      }
    });

    // Group leads by student to get ACTIVE leads count
    // We want to count leads where status is NOT 'paid' and NOT 'cancelled'
    // Prisma groupBy doesn't support advanced filtering on relations easily in one go for all students 
    // without fetching a lot. 
    // But we can filter directly on leadsPipeline table.
    const activeLeadsByStudent = await prisma.leadsPipeline.groupBy({
      by: ['studentId'],
      where: {
        status: {
          notIn: ['paid', 'cancelled']
        }
      },
      _count: {
        id: true
      }
    });

    // Create a map of studentId -> { earnings, clients }
    const statsMap = new Map<string, { earnings: number, clients: number }>();

    earningsByStudent.forEach(item => {
      if (!item.studentId) return;
      const existing = statsMap.get(item.studentId) || { earnings: 0, clients: 0 };
      existing.earnings = item._sum.amount || 0;
      statsMap.set(item.studentId, existing);
    });

    activeLeadsByStudent.forEach(item => {
      // Note: We are using 'clients' property name to match frontend expectation for now, 
      // but logically it is 'activeLeads'
      const existing = statsMap.get(item.studentId) || { earnings: 0, clients: 0 };
      existing.clients = item._count.id || 0;
      statsMap.set(item.studentId, existing);
    });

    // We also need to include the current user even if they have 0 stats, 
    // so we can show their rank.
    if (!statsMap.has(currentStudentId)) {
      statsMap.set(currentStudentId, { earnings: 0, clients: 0 });
    }

    const allStats = Array.from(statsMap.entries()).map(([studentId, stats]) => ({
      studentId,
      ...stats
    }));

    allStats.sort((a, b) => b.earnings - a.earnings);

    // Assign ranks
    const rankedList = allStats.map((item, index) => ({
      ...item,
      rank: index + 1
    }));

    // Identify top 10 positions + current user position
    const top10 = rankedList.slice(0, 10);
    const currentUserEntry = rankedList.find(r => r.studentId === currentStudentId);

    // If current user is not in top 10, add them to the list of IDs to fetch
    const idsToFetch = new Set(top10.map(r => r.studentId));
    if (currentUserEntry) {
      idsToFetch.add(currentUserEntry.studentId);
    }

    const students = await prisma.student.findMany({
      where: {
        id: { in: Array.from(idsToFetch) }
      },
      select: {
        id: true,
        name: true,
        universityName: true
      }
    });

    const studentMap = new Map<string, typeof students[number]>(students.map(s => [s.id, s]));

    const finalResponse = top10.map(r => {
      const s = studentMap.get(r.studentId);
      return {
        rank: r.rank,
        name: s?.name || 'Unknown',
        university: s?.universityName || 'Unknown',
        earnings: r.earnings,
        clients: r.clients, // This is now Active Leads count
        isCurrentUser: r.studentId === currentStudentId
      };
    });

    if (currentUserEntry && currentUserEntry.rank > 10) {
      const s = studentMap.get(currentUserEntry.studentId);
      finalResponse.push({
        rank: currentUserEntry.rank,
        name: s?.name || 'Unknown',
        university: s?.universityName || 'Unknown',
        earnings: currentUserEntry.earnings,
        clients: currentUserEntry.clients,
        isCurrentUser: true
      });
    }

    res.json(finalResponse);

  } catch (err) {
    console.error("Get Leaderboard error:", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
}

export async function getRecentActivity(
  req: Request,
  res: Response
) {
  try {
    const studentId = (req as any).studentId;


    const start = Date.now();

    // Run all queries in parallel
    const [commissions, newLeads, payouts] =
      await Promise.all([
        prisma.ledgerEntry.findMany({
          where: {
            studentId,
            type: "student_commission",
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
          include: {
            leadsPipeline: {
              select: {
                paidAt: true,
                client: {
                  select: {
                    businessName: true,
                  },
                },
              },
            },
          },
        }),

        prisma.leadsPipeline.findMany({
          where: {
            studentId,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
          include: {
            client: {
              select: {
                businessName: true,
              },
            },
          },
        }),

        prisma.studentPayout.findMany({
          where: {
            studentId,
          },
          orderBy: {
            createdAt: "desc",
          },
          take: 5,
        }),
      ]);

    const activities: any[] = [];

    // Commission Activities
    commissions.forEach((comm) => {
      const activityTime =
        comm.leadsPipeline?.paidAt ||
        comm.createdAt;

      activities.push({
        id: `comm_${comm.id}`,
        type: "payment",
        title: "Commission Approved",
        description: `Earned from ${comm.leadsPipeline?.client
            ?.businessName || "Client"
          }`,
        time: activityTime,
        amount: comm.amount,
        rawTime: new Date(
          activityTime
        ).getTime(),
      });
    });

    // Lead Activities
    newLeads.forEach((lead) => {
      activities.push({
        id: `lead_${lead.id}`,
        type: "conversion",
        title: "New Client Lead",
        description: `${lead.client.businessName} added to pipeline`,
        time: lead.createdAt,
        amount:
          lead.dealAmount || undefined,
        rawTime: new Date(
          lead.createdAt
        ).getTime(),
      });
    });

    // Payout Activities
    payouts.forEach((payout) => {
      let title = "Payout Requested";
      let description = `Payout request of ₹${payout.amount} is ${payout.status}`;

      if (
        payout.status === "completed"
      ) {
        title = "Payout Sent";
        description = `Payout of ₹${payout.amount} has been sent to your account`;
      } else if (
        payout.status === "processing"
      ) {
        title = "Payout Processing";
        description = `Payout of ₹${payout.amount} is being processed`;
      } else if (
        payout.status === "failed"
      ) {
        title = "Payout Failed";
        description = `Payout of ₹${payout.amount} failed. Please check details.`;
      }

      activities.push({
        id: `payout_${payout.id}`,
        type:
          payout.status === "completed"
            ? "payment"
            : "milestone",
        title,
        description,
        time: payout.createdAt,
        amount: Number(
          payout.amount
        ),
        rawTime: new Date(
          payout.createdAt
        ).getTime(),
      });
    });

    activities.sort(
      (a, b) =>
        b.rawTime - a.rawTime
    );

    const now = Date.now();

    const topActivities = activities
      .slice(0, 10)
      .map((a) => {
        const diffMs =
          now -
          new Date(a.time).getTime();

        const diffHours =
          Math.floor(
            diffMs /
            (1000 * 60 * 60)
          );

        const diffDays =
          Math.floor(
            diffHours / 24
          );

        let relativeTime =
          "Just now";

        if (diffDays > 0) {
          relativeTime = `${diffDays} day${diffDays > 1 ? "s" : ""
            } ago`;
        } else if (
          diffHours > 0
        ) {
          relativeTime = `${diffHours} hour${diffHours > 1
              ? "s"
              : ""
            } ago`;
        }

        return {
          ...a,
          time: relativeTime,
        };
      });

    console.log(
      `getRecentActivity took ${Date.now() - start
      }ms`
    );

    return res.json(
      topActivities
    );


  } catch (err) {
    console.error(
      "Get Recent Activity error:",
      err
    );


    return res.status(500).json({
      error:
        "Failed to fetch recent activity",
    });


  }
}


export async function getNotifications(
  req: Request,
  res: Response
) {
  try {
    const studentId = (req as any).studentId;

    const notifications =
      await prisma.notification.findMany({
        where: {
          studentId,
        },
        select: {
          id: true,
          type: true,
          title: true,
          description: true,
          amount: true,
          read: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      });

    const now = Date.now();

    const formatted = notifications.map((n) => {
      const diffMs =
        now - new Date(n.createdAt).getTime();

      const diffHours = Math.floor(
        diffMs / (1000 * 60 * 60)
      );

      const diffDays = Math.floor(
        diffHours / 24
      );

      let time = "Just now";

      if (diffDays > 0) {
        time = `${diffDays} day${diffDays > 1 ? "s" : ""
          } ago`;
      } else if (diffHours > 0) {
        time = `${diffHours} hour${diffHours > 1 ? "s" : ""
          } ago`;
      }

      return {
        id: n.id,
        type: n.type,
        title: n.title,
        description: n.description,
        time,
        amount: n.amount
          ? Number(n.amount)
          : undefined,
        read: n.read,
      };
    });

    return res.json(formatted);


  } catch (err) {
    console.error(
      "Get Notifications error:",
      err
    );


    return res.status(500).json({
      error: "Failed to fetch notifications",
    });


  }
}


export async function markNotificationAsRead(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Notification ID is required" });
    }

    await prisma.notification.update({
      where: { id: String(id), studentId }, // Ensure ownership
      data: { read: true }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Mark Notification Read error:", err);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
}

export async function markAllNotificationsAsRead(req: Request, res: Response) {
  try {
    const studentId = (req as any).studentId;

    await prisma.notification.updateMany({
      where: { studentId, read: false },
      data: { read: true }
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Mark All Read error:", err);
    res.status(500).json({ error: "Failed to mark all as read" });
  }
}
