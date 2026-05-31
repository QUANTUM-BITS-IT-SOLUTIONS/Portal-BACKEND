import { cleanupOldNotifications } from '../controllers/notification-controller';

export const startNotificationCleanupJob = () => {
    // Run cleanup every hour
    setInterval(async () => {
        try {
            await cleanupOldNotifications();
        } catch (error) {
            console.error('Notification cleanup job failed:', error);
        }
    }, 60 * 60 * 1000); // 1 hour

    console.log('Notification cleanup job started - running every hour');
};
