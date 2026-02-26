import { cronJobs } from "@vex/server";

const crons = cronJobs();

// Clean up old messages every hour
crons.interval("cleanup old messages", { seconds: 5 }, "messages:cleanupOld", {});

export default crons;
