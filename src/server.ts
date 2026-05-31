import app from "./app";
import { startNotificationCleanupJob } from "./jobs/notification-cleanup";

const PORT = 3001;

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);

  // Start notification cleanup job
  startNotificationCleanupJob();
});
