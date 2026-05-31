import prisma from "../lib/prisma";

export interface AuditLogData {
    userId: string;
    action: string;
    entityType: string;
    entityId?: string | null;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    ipAddress?: string | null;
}

/**
 * Centralized Audit Logging Service
 * 
 * Provides methods to log all critical actions in the system for
 * security, compliance, and debugging purposes.
 */
class AuditService {
    /**
     * Log an audit entry
     * @param data Audit log data
     * @returns Promise<void>
     */
    async log(data: AuditLogData): Promise<void> {
        try {
            await prisma.auditLog.create({
                data: {
                    userId: data.userId,
                    action: data.action,
                    entityType: data.entityType,
                    entityId: data.entityId || null,
                    oldValues: (data.oldValues as any) || null,
                    newValues: (data.newValues as any) || null,
                    metadata: (data.metadata as any) || {},
                    ipAddress: data.ipAddress || null,
                },
            });
        } catch (error) {
            // Log to console but don't throw - audit logging should not break app flow
            console.error("Audit logging failed:", error);
        }
    }

    /**
     * Log an audit entry without waiting (fire-and-forget)
     * Use this for non-critical audit points where you don't want to slow down the request
     */
    logAsync(data: AuditLogData): void {
        this.log(data).catch((error) => {
            console.error("Async audit logging failed:", error);
        });
    }

    /**
     * Get audit logs with filtering and pagination
     */
    async getLogs(options: {
        userId?: string;
        action?: string;
        entityType?: string;
        entityId?: string;
        limit?: number;
        offset?: number;
        startDate?: Date;
        endDate?: Date;
    }) {
        const where: any = {};

        if (options.userId) where.userId = options.userId;
        if (options.action) where.action = options.action;
        if (options.entityType) where.entityType = options.entityType;
        if (options.entityId) where.entityId = options.entityId;

        if (options.startDate || options.endDate) {
            where.createdAt = {};
            if (options.startDate) where.createdAt.gte = options.startDate;
            if (options.endDate) where.createdAt.lte = options.endDate;
        }

        const [logs, total] = await Promise.all([
            prisma.auditLog.findMany({
                where,
                orderBy: { createdAt: "desc" },
                take: options.limit || 100,
                skip: options.offset || 0,
            }),
            prisma.auditLog.count({ where }),
        ]);

        return { logs, total };
    }

    /**
     * Get audit logs for a specific entity
     */
    async getEntityLogs(entityType: string, entityId: string) {
        return prisma.auditLog.findMany({
            where: {
                entityType,
                entityId,
            },
            orderBy: { createdAt: "desc" },
        });
    }
}

// Export singleton instance
export const auditService = new AuditService();
