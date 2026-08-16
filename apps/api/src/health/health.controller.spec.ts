import { HttpException } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

describe("HealthController", () => {
  it("returns the health response as-is when all checks are ok", async () => {
    const service = { check: jest.fn().mockResolvedValue({ status: "ok", service: "api", checks: [] }) } as unknown as HealthService;
    const controller = new HealthController(service);
    await expect(controller.check()).resolves.toEqual({ status: "ok", service: "api", checks: [] });
  });

  it("throws a 503 HttpException carrying the full body when degraded", async () => {
    const degraded = {
      status: "degraded",
      service: "api",
      checks: [{ name: "redis", status: "error", detail: "boom" }],
    };
    const service = { check: jest.fn().mockResolvedValue(degraded) } as unknown as HealthService;
    const controller = new HealthController(service);
    const error = (await controller.check().catch((e: unknown) => e)) as HttpException;
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual(degraded);
  });
});
