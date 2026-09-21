import { getStore } from "./db";
import { errorDetails, logger } from "./logger";

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

export function startWebhookWorker() {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await getStore().webhooks.dispatchDue();
    } catch (error) {
      logger.error(
        { event: "webhook.worker_error", ...errorDetails(error) },
        "Webhook worker failed",
      );
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => {
    void tick();
  }, 5_000);
  timer.unref();
  void tick();
  logger.info(
    { event: "webhook.worker_started", pollIntervalMs: 5_000 },
    "Webhook worker started",
  );
}
