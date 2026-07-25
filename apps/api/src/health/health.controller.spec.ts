import { HealthController } from "./health.controller";

describe("HealthController", () => {
  it("reports ok for the api service", () => {
    const controller = new HealthController();
    expect(controller.check()).toEqual({ status: "ok", service: "api" });
  });
});
