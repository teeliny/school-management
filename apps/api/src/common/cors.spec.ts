import { ConfigService } from "@nestjs/config";
import { parseCorsOrigins } from "./cors";

function configWith(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("parseCorsOrigins", () => {
  it("uses CORS_ORIGIN when set, splitting on commas", () => {
    const config = configWith({ CORS_ORIGIN: "https://a.example.com, https://b.example.com" });
    expect(parseCorsOrigins(config)).toEqual(["https://a.example.com", "https://b.example.com"]);
  });

  it("falls back to WEB_BASE_URL when CORS_ORIGIN is unset", () => {
    const config = configWith({ WEB_BASE_URL: "http://localhost:3000" });
    expect(parseCorsOrigins(config)).toEqual(["http://localhost:3000"]);
  });

  it("falls back to a dev default when neither is set", () => {
    const config = configWith({});
    expect(parseCorsOrigins(config)).toEqual(["http://localhost:3000"]);
  });
});
