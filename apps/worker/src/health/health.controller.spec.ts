import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("reports ok for the worker service", () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: "ok", service: "worker" });
  });
});
