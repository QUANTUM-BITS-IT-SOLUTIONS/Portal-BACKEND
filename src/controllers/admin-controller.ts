import { Request, Response } from "express";
import prisma from "../lib/prisma";
import { signAdminToken } from "../utils/jwt";
import { LeadStatus } from "@prisma/client";
import { updateStudentTier } from "../utils/tier-manager";
import { auditService } from "../utils/audit.service";
import { createNotificationForStudent } from "./notification-controller";

/**
 * Admin Login
 */
export async function adminLogin(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const admin = await prisma.admin.findUnique({
      where: { email },
    });

    if (!admin || admin.password !== password) {
      // Audit failed login
      auditService.logAsync({
        userId: email,
        action: "ADMIN_LOGIN_FAILED",
        entityType: "Admin",
        metadata: { email },
        ipAddress: req.ip,
      });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signAdminToken(admin.id);

    return res.json({ token });
  } catch (err) {
    console.error("Admin login error:", err);
    return res.status(500).json({ error: "Login failed" });
  }
}

export async function getLeads(req: Request, res: Response) {
  const statusParam = req.query.status as string | undefined;
  const status = statusParam as LeadStatus | undefined;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const [leads, total] = await Promise.all([
    prisma.leadsPipeline.findMany({
      where: status ? { status } : {},
      include: {
        client: true,
        student: true,
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.leadsPipeline.count({
      where: status ? { status } : {},
    })
  ]);

  res.json({ leads, total, page, totalPages: Math.ceil(total / limit) });
}

/**
 * Update Lead Status
 */
export async function updateLeadStatus(req: Request, res: Response) {
  const { id } = req.params;
  const { status, payment_link, deal_value, transaction_id, payment_type, payment_percentage } = req.body;

  if (status === "paid") {
    return res.status(400).json({
      error: "Paid status not allowed in Phase 4 - use mark-paid endpoint",
    });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      let notesUpdate = undefined;

      const currentLead = await tx.leadsPipeline.findUnique({
        where: { id: id as string },
        include: { student: { include: { partnerTier: true } }, client: true }
      });

      if (!currentLead) throw new Error("Lead not found");

      if (transaction_id) {
        notesUpdate = currentLead.notes
          ? `${currentLead.notes}\nTransaction ID: ${transaction_id}`
          : `Transaction ID: ${transaction_id}`;
      }

      const data: any = {
        status,
        paymentLink: payment_link || undefined,
      };

      if (deal_value) {
        data.dealAmount = deal_value;
      }

      if (payment_type) {
        data.paymentType = payment_type;
      }

      if (payment_percentage !== undefined) {
        data.paymentPercentage = payment_percentage;
      }

      if (notesUpdate) {
        data.notes = notesUpdate;
      }

      // If status is changing to 'client_pays', set the paidAt date
      if (status === 'client_pays') {
        data.paidAt = new Date();
      }

      // If status is changing to 'commission_approved'
      if (status === 'commission_approved') {
        // Ensure Ledger Entry exists (commission recognized)
        const existingEntries = await tx.ledgerEntry.findMany({
          where: {
            leadsPipelineId: id as string,
            type: { in: ['client_payment', 'student_commission'] }
          }
        });

        const hasCommission = existingEntries.some(e => e.type === 'student_commission');
        const hasClientPayment = existingEntries.some(e => e.type === 'client_payment');

        let commissionEntry = existingEntries.find(e => e.type === 'student_commission');

        if (!hasCommission || !hasClientPayment) {
          // Auto-generate ledger entry if missing (e.g. if lead was manually moved without mark-paid)
          if (!currentLead.dealAmount || currentLead.dealAmount <= 0) {
            throw new Error("Deal Value is required to approve commission.");
          }

          // Use lead's snapshot rate if available, fallback to student's current commissionPercent
          const leadPercentage = currentLead.commissionRate
            ? Number(currentLead.commissionRate)
            : (currentLead.student.partnerTier?.commissionPercentage
              ? Number(currentLead.student.partnerTier.commissionPercentage)
              : Number(currentLead.student.commissionPercent));

          const commissionAmount = Math.floor(
            (currentLead.dealAmount * leadPercentage) / 100
          );

          // 1. Create Client Payment Ledger (if not exists)
          if (!hasClientPayment) {
            await tx.ledgerEntry.create({
              data: {
                type: "client_payment",
                amount: currentLead.dealAmount,
                leadsPipelineId: id as string,
                studentId: currentLead.studentId,
              }
            });
          }

          // 2. Create Student Commission Ledger (if not exists)
          if (!hasCommission) {
            commissionEntry = await tx.ledgerEntry.create({
              data: {
                type: "student_commission",
                amount: commissionAmount,
                leadsPipelineId: id as string,
                studentId: currentLead.studentId,
              }
            });

            // Link commission to payout
            // Removed redundant payout creation here - handled by safety check below
          }
        }

        if (!commissionEntry) {
          // This case should theoretically not be hit now, but for safety:
          throw new Error("Failed to ensure commission entry exists.");
        }

        // Ensure a payout exists for this commission if it doesn't have one (Safety check)
        if (commissionEntry.id && !commissionEntry.payoutId) {
          const payout = await tx.studentPayout.create({
            data: {
              studentId: currentLead.studentId,
              amount: commissionEntry.amount,
              status: 'pending',
              notes: `Auto-generated for lead: ${currentLead.client?.businessName || 'Lead'}`,
            }
          });
          await tx.ledgerEntry.update({
            where: { id: commissionEntry.id },
            data: { payoutId: payout.id }
          });
        }


        // Set commissionStatus to approved
        data.commissionStatus = 'approved';

        // Create notification for student about commission approval
        await createNotificationForStudent(
          currentLead.studentId,
          'milestone',
          'Commission Approved! 🎉',
          `Your commission for ${currentLead.client.businessName || 'client'} has been approved and added to your wallet.`,
          commissionEntry.amount
        );

        // Update data object is already set to status='commission_approved'
      }

      const lead = await tx.leadsPipeline.update({
        where: { id: id as string },
        data,
      });

      // Audit log
      const adminId = (req as any).adminId;
      auditService.logAsync({
        userId: adminId || 'system',
        action: "UPDATE_LEAD_STATUS",
        entityType: "LeadsPipeline",
        entityId: id as string,
        oldValues: {
          status: currentLead.status,
          dealAmount: currentLead.dealAmount,
          commissionStatus: currentLead.commissionStatus,
        },
        newValues: {
          status,
          dealAmount: deal_value,
          commissionStatus: data.commissionStatus,
        },
        metadata: { payment_type, payment_percentage },
        ipAddress: req.ip,
      });

      return lead;
    });

    // Post-transaction: Update Student Tier
    if (result && result.studentId) {
      await updateStudentTier(result.studentId);
    }

    res.json({ lead: result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
}



export async function markLeadAsPaid(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { deal_amount } = req.body;

  if (!deal_amount || deal_amount <= 0) {
    return res.status(400).json({ error: "Invalid deal amount" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lead = await tx.leadsPipeline.findUnique({
        where: { id },
        include: { student: { include: { partnerTier: true } }, client: true },
      });

      if (!lead) {
        throw new Error("Lead not found");
      }

      if (lead.status === "paid") {
        throw new Error("Lead already marked as paid");
      }

      // Use lead's snapshot rate if available, fallback to student's current commissionPercent
      const leadPercentage = lead.commissionRate
        ? Number(lead.commissionRate)
        : (lead.student.partnerTier?.commissionPercentage
          ? Number(lead.student.partnerTier.commissionPercentage)
          : Number(lead.student.commissionPercent));

      // Commission is ALWAYS calculated on FULL deal amount (not partial)
      // This ensures full commission is available when commission is approved
      const commissionAmount = Math.floor((deal_amount * leadPercentage) / 100);
      const isPartial = lead.paymentType === 'partial';
      const paymentPercentage = lead.paymentPercentage || 100;

      // Calculate initial ledger amounts for CLIENT PAYMENT only (partial if applicable)
      const ledgerClientAmount = isPartial
        ? Math.floor((deal_amount * paymentPercentage) / 100)
        : deal_amount;

      // Commission is ALWAYS full amount (user requirement: full commission on approval)
      const ledgerCommissionAmount = commissionAmount;

      // 1️⃣ Update lead
      const updatedLead = await tx.leadsPipeline.update({
        where: { id },
        data: {
          status: "paid",
          dealAmount: deal_amount,
          paidAt: new Date(),
        },
      });

      // 2️⃣ Ledger: client payment (Check if already exists to prevent duplication)
      const existingClientPayment = await tx.ledgerEntry.findFirst({
        where: { leadsPipelineId: id, type: 'client_payment', amount: ledgerClientAmount }
      });
      if (!existingClientPayment) {
        await tx.ledgerEntry.create({
          data: {
            type: "client_payment",
            amount: ledgerClientAmount,
            leadsPipelineId: id,
            isPartial: isPartial,
            studentId: lead.studentId, // Ensure studentId is linked
          },
        });
      }

      // 3️⃣ Ledger: student commission (Check if already exists)
      const existingCommission = await tx.ledgerEntry.findFirst({
        where: { leadsPipelineId: id, type: 'student_commission' }
      });
      if (!existingCommission) {
        await tx.ledgerEntry.create({
          data: {
            type: 'student_commission',
            amount: ledgerCommissionAmount,
            leadsPipelineId: id,
            studentId: lead.studentId,
            isPartial: false, // Commission is never partial
          },
        });
      }

      // Audit log
      const adminId = (req as any).adminId;
      auditService.logAsync({
        userId: adminId || 'system',
        action: "MARK_LEAD_PAID",
        entityType: "LeadsPipeline",
        entityId: id,
        oldValues: { status: lead.status, dealAmount: lead.dealAmount },
        newValues: { status: "paid", dealAmount: deal_amount },
        ipAddress: req.ip,
      });

      return updatedLead;
    });

    if (result && result.studentId) {
      await updateStudentTier(result.studentId);
    }

    res.json({ lead: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Complete Partial Payment - marks partial payment as fully paid
 */
export async function completePartialPayment(req: Request, res: Response) {
  const { id } = req.params as { id: string };
  const { remaining_amount } = req.body;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const lead = await tx.leadsPipeline.findUnique({
        where: { id },
        include: { student: { include: { partnerTier: true } }, client: true },
      });

      if (!lead) {
        throw new Error("Lead not found");
      }

      if (lead.paymentType !== 'partial') {
        throw new Error("Lead is not a partial payment");
      }

      // Calculate the remaining amount
      const originalDeal = lead.dealAmount || 0;
      const paidPercentage = lead.paymentPercentage || 0;
      const alreadyPaid = Math.floor((originalDeal * paidPercentage) / 100);
      const finalRemainingAmount = remaining_amount || (originalDeal - alreadyPaid);

      // NO additional commission - full commission was already created at markLeadAsPaid

      // Update lead to full payment
      const updatedLead = await tx.leadsPipeline.update({
        where: { id },
        data: {
          paymentType: 'full',
          paymentPercentage: 100,
        },
      });

      // Create ledger entry for remaining client payment ONLY (no commission)
      // Check for existing entry of this amount to prevent duplicates on double-click
      const existingRemainingPayment = await tx.ledgerEntry.findFirst({
        where: {
          leadsPipelineId: id,
          type: "client_payment",
          amount: finalRemainingAmount,
          isPartial: false
        }
      });

      if (!existingRemainingPayment) {
        await tx.ledgerEntry.create({
          data: {
            type: "client_payment",
            amount: finalRemainingAmount,
            leadsPipelineId: id,
            studentId: lead.studentId,
            isPartial: false,
          },
        });
      }

      // Audit log
      const adminId = (req as any).adminId;
      auditService.logAsync({
        userId: adminId || 'system',
        action: "COMPLETE_PARTIAL_PAYMENT",
        entityType: "LeadsPipeline",
        entityId: id,
        oldValues: { paymentType: 'partial', paymentPercentage: lead.paymentPercentage },
        newValues: { paymentType: 'full', paymentPercentage: 100 },
        metadata: { remainingAmount: finalRemainingAmount },
        ipAddress: req.ip,
      });

      return updatedLead;
    });

    if (result && result.studentId) {
      await updateStudentTier(result.studentId);
    }

    res.json({ lead: result, message: "Partial payment completed successfully" });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * Settle Payout Request (Gap 1)
 */
export async function settlePayout(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const payout = await tx.studentPayout.findUnique({
        where: { id },
      });

      if (!payout) {
        throw new Error("Payout not found");
      }

      if (payout.status === "completed") {
        throw new Error("Payout already settled");
      }

      // 1. Update Payout Status
      const updatedPayout = await tx.studentPayout.update({
        where: { id },
        data: {
          status: "completed",
          completedDate: new Date(),
          paidAt: new Date(),
        },
      });

      // 2. Create Ledger Entry (Negative)
      // Check for existing payout_sent entry
      const existingEntry = await tx.ledgerEntry.findFirst({
        where: {
          payoutId: id,
          type: "payout_sent"
        }
      });

      if (!existingEntry) {
        await tx.ledgerEntry.create({
          data: {
            type: "payout_sent",
            amount: -Math.floor(Number(payout.amount)),
            payoutId: id,
            studentId: payout.studentId,
          },
        });
      }

      // 3. Update Leads status to commission_paid
      const commissionEntries = await tx.ledgerEntry.findMany({
        where: { payoutId: id, type: "student_commission" },
        select: { leadsPipelineId: true }
      });

      const leadIds = commissionEntries
        .map(e => e.leadsPipelineId)
        .filter((leadId): leadId is string => leadId !== null);


      // Audit log
      const adminId = (req as any).adminId;
      auditService.logAsync({
        userId: adminId || 'system',
        action: "SETTLE_PAYOUT",
        entityType: "StudentPayout",
        entityId: id,
        oldValues: { status: payout.status },
        newValues: { status: "completed" },
        metadata: { amount: Number(payout.amount), studentId: payout.studentId, leadIds },
        ipAddress: req.ip,
      });

      return updatedPayout;
    });

    // Create notification for student about payout completion
    await createNotificationForStudent(
      result.studentId,
      'payment',
      'Payout Completed! 💰',
      `Your payout of ₹${Number(result.amount).toLocaleString('en-IN')} has been processed and sent to your account.`,
      Number(result.amount)
    );

    res.json({ payout: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
}

export async function getAllUsers(req: Request, res: Response) {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    prisma.student.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        partnerTier: true,
      },
      skip,
      take: limit,
    }),
    prisma.student.count()
  ]);

  res.json({ users, total, page, totalPages: Math.ceil(total / limit) });
}

/**
 * Get All Commissions
 */
export async function getAllCommissions(req: Request, res: Response) {
  const commissions = await prisma.ledgerEntry.findMany({
    where: { type: "student_commission" },
    include: {
      student: true,
      leadsPipeline: {
        include: {
          client: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({ commissions });
}


/**
 * Get User Details
 */
export async function getUserDetails(req: Request, res: Response) {
  const { id } = req.params as { id: string };

  try {
    const user = await prisma.student.findUnique({
      where: { id },
      include: {
        partnerTier: true,
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const leads = await prisma.leadsPipeline.findMany({
      where: { studentId: id },
      include: {
        client: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const commissions = await prisma.ledgerEntry.findMany({
      where: {
        studentId: id,
        type: "student_commission",
      },
      include: {
        leadsPipeline: {
          include: {
            client: true,
          }
        }
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ user, leads, commissions });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get Successful Clients
 */
export async function getClients(req: Request, res: Response) {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  try {
    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where: {
          leads: {
            some: {
              status: {
                in: ['paid', 'commission_approved', 'work_starts'] as LeadStatus[]
              }
            }
          }
        },
        select: {
          id: true,
          businessName: true,
          businessType: true,
          phone: true,
          email: true,
          studentId: true,
          createdAt: true,
          notes: true,
          student: {
            select: {
              name: true,
              email: true,
            }
          },
          leads: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.client.count({
        where: {
          leads: {
            some: {
              status: {
                in: ['paid', 'commission_approved', 'work_starts'] as LeadStatus[]
              }
            }
          }
        }
      })
    ]);

    res.json({ clients, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

export async function getPayouts(req: Request, res: Response) {
  const { status, partnerId, dateFrom, dateTo } = req.query;
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const skip = (page - 1) * limit;

  const where: any = {};
  // ... (keep previous where logic)
  if (status && status !== 'all') {
    where.status = status;
  }

  if (partnerId && partnerId !== 'all') {
    where.studentId = partnerId;
  }

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom as string);
    if (dateTo) where.createdAt.lte = new Date(dateTo as string);
  }

  try {
    const [payouts, total] = await Promise.all([
      prisma.studentPayout.findMany({
        where,
        include: {
          student: {
            select: {
              id: true,
              name: true,
              email: true,
              upiId: true,
              bankDetails: true,
              paymentMethod: true,
              phoneNumber: true,
              universityName: true,
              panNumber: true,
              panVerified: true,
            }
          },
          ledgerEntries: {
            include: {
              leadsPipeline: {
                include: {
                  client: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.studentPayout.count({ where })
    ]);

    res.json({ payouts, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Bulk Settle Payouts
 */
export async function bulkSettlePayouts(req: Request, res: Response) {
  const { payoutIds, notes } = req.body; // Expecting array of IDs

  if (!Array.isArray(payoutIds) || payoutIds.length === 0) {
    return res.status(400).json({ error: "No payout IDs provided" });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const settledPayouts = [];

      for (const id of payoutIds) {
        const payout = await tx.studentPayout.findUnique({ where: { id } });

        if (!payout || payout.status === "completed") continue;

        // 1. Update Payout
        const updatedPayout = await tx.studentPayout.update({
          where: { id },
          data: {
            status: "completed",
            completedDate: new Date(),
            paidAt: new Date(),
            notes: notes ? (payout.notes ? `${payout.notes}\n${notes}` : notes) : payout.notes
          },
        });

        // 2. Create Ledger Entry for each payout (Debit/Payout Sent)
        // Check if entry already exists
        const existingEntry = await tx.ledgerEntry.findFirst({
          where: {
            payoutId: id,
            type: "payout_sent"
          }
        });

        if (!existingEntry) {
          await tx.ledgerEntry.create({
            data: {
              type: "payout_sent",
              amount: -Math.floor(Number(payout.amount)), // Negative amount for payout
              payoutId: id,
              studentId: payout.studentId,
            },
          });
        }


        settledPayouts.push(updatedPayout);

        // Create notification for student about payout completion
        await createNotificationForStudent(
          payout.studentId,
          'payment',
          'Payout Completed! 💰',
          `Your payout of ₹${Number(payout.amount).toLocaleString('en-IN')} has been processed and sent to your account.`,
          Number(payout.amount)
        );
      }

      // Audit log for bulk operation
      const adminId = (req as any).adminId;
      auditService.logAsync({
        userId: adminId || 'system',
        action: "BULK_SETTLE_PAYOUTS",
        entityType: "StudentPayout",
        metadata: {
          payoutIds,
          count: settledPayouts.length,
          notes,
        },
        ipAddress: req.ip,
      });

      return settledPayouts;
    });

    res.json({ message: "Payouts settled successfully", count: result.length, payouts: result });
  } catch (error: any) {
    console.error("Bulk settle error:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get Audit Logs
 */
export async function getAuditLogs(req: Request, res: Response) {
  try {
    const { userId, action, entityType, entityId, limit, offset, startDate, endDate } = req.query;

    const options: any = {
      limit: limit ? parseInt(limit as string) : 100,
      offset: offset ? parseInt(offset as string) : 0,
    };

    if (userId) options.userId = userId as string;
    if (action) options.action = action as string;
    if (entityType) options.entityType = entityType as string;
    if (entityId) options.entityId = entityId as string;
    if (startDate) options.startDate = new Date(startDate as string);
    if (endDate) options.endDate = new Date(endDate as string);

    const { logs, total } = await auditService.getLogs(options);

    const page = Math.floor(options.offset / options.limit) + 1;
    const totalPages = Math.ceil(total / options.limit);

    res.json({ logs, total, page, totalPages });
  } catch (error: any) {
    console.error("Get audit logs error:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Get Audit Logs for Specific Entity
 */
export async function getEntityAuditLogs(req: Request, res: Response) {
  try {
    const { entityType, entityId } = req.params;

    const logs = await auditService.getEntityLogs(
      Array.isArray(entityType) ? entityType[0] : entityType,
      Array.isArray(entityId) ? entityId[0] : entityId
    );

    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
}

/**
 * Create Manual Payout
 */
export async function createManualPayout(req: Request, res: Response) {
  const { studentId, amount, notes, password } = req.body;
  const adminId = (req as any).adminId;

  try {
    // 2. Create Payout & Ledger Entry
    console.log(`DEBUG: Creating payout for student ${studentId} with amount ${amount}`);

    const result = await prisma.$transaction(async (tx) => {
      // Create Payout Record
      const payout = await tx.studentPayout.create({
        data: {
          studentId,
          amount: Number(amount),
          status: 'processing',
          notes: notes,
        }
      });
      console.log(`DEBUG: Payout created with ID: ${payout.id}`);
      return payout;
    });

    // 3. Audit Log
    const actionDescription = `MANUAL_PAYOUT: Created payout of ${amount} for student ${studentId}. Notes: ${notes || 'None'}`;

    auditService.logAsync({
      userId: adminId,
      action: actionDescription,
      entityType: "StudentPayout",
      entityId: result.id,
      metadata: {
        amount,
        studentId,
        notes,
      },
      ipAddress: req.ip,
    });

    res.json({ message: "Manual payout created successfully", payout: result });

  } catch (error: any) {
    console.error("Create manual payout error:", error);
    res.status(500).json({ error: error.message });
  }
}
// Get Ledger Entries
export async function getLedger(req: Request, res: Response) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const type = req.query.type as string | undefined;
    const studentId = req.query.studentId as string | undefined;
    const skip = (page - 1) * limit;

    // Build where clause for filters
    const where: any = {};
    if (type && type !== 'all') {
      where.type = type;
    }
    if (studentId && studentId !== 'all') {
      where.studentId = studentId;
    }

    const [entries, total] = await Promise.all([
      prisma.ledgerEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          student: {
            select: { id: true, name: true, email: true }
          },
          leadsPipeline: {
            select: {
              id: true,
              dealAmount: true,
              client: { select: { businessName: true } }
            }
          },
          payout: {
            select: { id: true, status: true, amount: true }
          }
        }
      }),
      prisma.ledgerEntry.count({ where })
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      entries,
      total,
      page,
      totalPages
    });
  } catch (error) {
    console.error("Get ledger error:", error);
    res.status(500).json({ error: "Failed to fetch ledger" });
  }
}

/**
 * Update User Status (Ban/Unban)
 */
export async function updateUserStatus(req: Request, res: Response) {
  const id = req.params.id as string;
  const { status } = req.body;

  if (!['ACTIVE', 'INACTIVE', 'BANNED'].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    const adminId = (req as any).adminId;
    const oldUser = await prisma.student.findUnique({
      where: { id },
      select: { status: true }
    });

    if (!oldUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const updatedUser = await prisma.student.update({
      where: { id },
      data: { status },
      include: { partnerTier: true }
    });

    // Audit Log
    auditService.logAsync({
      userId: adminId || 'system',
      action: "UPDATE_USER_STATUS",
      entityType: "Student",
      entityId: id,
      oldValues: { status: oldUser.status },
      newValues: { status: updatedUser.status },
      metadata: { reason: req.body.reason || "Admin update" },
      ipAddress: req.ip,
    });

    res.json({ user: updatedUser });
  } catch (error: any) {
    console.error("Update user status error:", error);
    res.status(500).json({ error: error.message });
  }
}

