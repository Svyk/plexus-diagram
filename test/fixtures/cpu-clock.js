// Milliseconds of CPU this thread has spent. A speed budget measured with it holds on a loaded runner: time the
// thread waits for a core is not counted. Node 20 has no threadCpuUsage; the process total is close for these tests.
export function cpuNow() {
  const usage = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}
