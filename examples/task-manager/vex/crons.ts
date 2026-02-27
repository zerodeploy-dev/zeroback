import { cronJobs } from "@vex/server";

const crons = cronJobs();

crons.interval("cleanup done tasks", { seconds: 5 }, "tasks:cleanupDone", {});

export default crons;
