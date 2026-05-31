import { Request, Response } from 'express';
import prisma from '../lib/prisma';
import { NotificationType } from '@prisma/client';

// Helper function to create notifications programmatically
export const createNotificationForStudent = async (
    studentId: string,
    type: NotificationType,
    title: string,
    description: string,
    amount?: number
) => {
    try {
        return await prisma.notification.create({
            data: {
                studentId,
                type,
                title,
                description,
                amount: amount ? parseFloat(amount.toString()) : null,
            },
        });
    } catch (error) {
        console.error('Error creating notification:', error);
        return null;
    }
};


// Admin: Create notification (for all users or specific user)
export const createNotification = async (req: Request, res: Response) => {
    try {
        const { title, description, type, studentId, amount } = req.body;

        if (!title || !description || !type) {
            return res.status(400).json({ error: 'Title, description, and type are required' });
        }

        // If studentId is provided, create for specific user
        if (studentId) {
            const notification = await prisma.notification.create({
                data: {
                    studentId,
                    type,
                    title,
                    description,
                    amount: amount ? parseFloat(amount.toString()) : null,
                },
            });
            return res.json(notification);
        }

        // If no studentId, create for all active students
        const students = await prisma.student.findMany({
            where: { status: 'ACTIVE' },
            select: { id: true },
        });

        const notifications = await prisma.notification.createMany({
            data: students.map(student => ({
                studentId: student.id,
                type,
                title,
                description,
                amount: amount ? parseFloat(amount) : null,
            })),
        });

        res.json({
            message: `Created ${notifications.count} notifications`,
            count: notifications.count
        });
    } catch (error) {
        console.error('Create notification error:', error);
        res.status(500).json({ error: 'Failed to create notification' });
    }
};

// Admin: Get all notifications with student info
export const getAllNotifications = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const skip = (page - 1) * limit;

        const [notifications, total] = await Promise.all([
            prisma.notification.findMany({
                include: {
                    student: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
            }),
            prisma.notification.count()
        ]);

        const totalPages = Math.ceil(total / limit);

        res.json({
            notifications,
            total,
            page,
            totalPages
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

// Admin: Delete notification
export const deleteNotification = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        // Ensure id is a string
        const notificationId = Array.isArray(id) ? id[0] : id;

        await prisma.notification.delete({
            where: { id: notificationId },
        });

        res.json({ message: 'Notification deleted successfully' });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
};

// Admin: Delete all notifications for a specific title (batch delete)
export const deleteNotificationsByTitle = async (req: Request, res: Response) => {
    try {
        const { title } = req.body;

        const result = await prisma.notification.deleteMany({
            where: { title },
        });

        res.json({
            message: `Deleted ${result.count} notifications`,
            count: result.count
        });
    } catch (error) {
        console.error('Delete notifications error:', error);
        res.status(500).json({ error: 'Failed to delete notifications' });
    }
};

// Student: Get user's notifications
export const getUserNotifications = async (req: Request, res: Response) => {
    try {
        // Run cleanup of old read notifications
        cleanupOldNotifications().catch(err => console.error("Auto-cleanup failed:", err));
        const studentId = (req as any).studentId;

        const notifications = await prisma.notification.findMany({
            where: { studentId },
            orderBy: { createdAt: 'desc' },
        });

        // Format notifications to match frontend interface
        const formattedNotifications = notifications.map(notification => {
            const now = new Date();
            const createdAt = new Date(notification.createdAt);
            const diffMs = now.getTime() - createdAt.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            let timeString: string;
            if (diffMins < 1) {
                timeString = 'Just now';
            } else if (diffMins < 60) {
                timeString = `${diffMins}m ago`;
            } else if (diffHours < 24) {
                timeString = `${diffHours}h ago`;
            } else if (diffDays < 7) {
                timeString = `${diffDays}d ago`;
            } else {
                timeString = createdAt.toLocaleDateString();
            }

            return {
                id: notification.id,
                type: notification.type,
                title: notification.title,
                description: notification.description,
                time: timeString,
                amount: notification.amount ? Number(notification.amount) : undefined,
                read: notification.read,
            };
        });

        res.json(formattedNotifications);
    } catch (error) {
        console.error('Get user notifications error:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
};

// Student: Mark notification as read
export const markNotificationAsRead = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const studentId = (req as any).studentId;

        // Ensure id is a string
        const notificationId = Array.isArray(id) ? id[0] : id;

        // Verify notification belongs to user
        const notification = await prisma.notification.findFirst({
            where: { id: notificationId, studentId },
        });

        if (!notification) {
            return res.status(404).json({ error: 'Notification not found' });
        }

        const updated = await prisma.notification.update({
            where: { id: notificationId },
            data: {
                read: true,
                readAt: new Date()
            },
        });

        res.json(updated);
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
};

// Student: Mark all notifications as read
export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
    try {
        const studentId = (req as any).studentId;

        const result = await prisma.notification.updateMany({
            where: {
                studentId,
                read: false,
            },
            data: {
                read: true,
                readAt: new Date()
            },
        });

        res.json({
            message: `Marked ${result.count} notifications as read`,
            count: result.count
        });
    } catch (error) {
        console.error('Mark all as read error:', error);
        res.status(500).json({ error: 'Failed to mark notifications as read' });
    }
};

// Cleanup: Delete notifications that were read more than 24 hours ago
export const cleanupOldNotifications = async () => {
    try {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const result = await prisma.notification.deleteMany({
            where: {
                read: true,
                readAt: {
                    lte: oneDayAgo
                }
            }
        });

        console.log(`Cleaned up ${result.count} old notifications`);
        return result.count;
    } catch (error) {
        console.error('Notification cleanup error:', error);
        return 0;
    }
};
