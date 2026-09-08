import { ArgumentsHost } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaExceptionFilter } from "./prisma-exception.filter";

function hostFor(res: { status: jest.Mock }): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
}

function prismaError(code: string, meta?: Record<string, unknown>): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "test", meta });
}

describe("PrismaExceptionFilter", () => {
  const filter = new PrismaExceptionFilter();

  function catchAndCapture(exception: Prisma.PrismaClientKnownRequestError) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    filter.catch(exception, hostFor({ status }));
    return { status, json };
  }

  it("maps P2025 (record not found) to a 404 with a distinct message", () => {
    const { status, json } = catchAndCapture(prismaError("P2025"));
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: "The requested record was not found" }));
  });

  it("maps P2002 (unique constraint) to a 409 naming the conflicting field", () => {
    const { status, json } = catchAndCapture(prismaError("P2002", { target: ["email"] }));
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: "A record with this email already exists" }));
  });

  it("maps P2003 (foreign key violation) to a 400 naming the field", () => {
    const { status, json } = catchAndCapture(prismaError("P2003", { field_name: "classArmId" }));
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("classArmId") }),
    );
  });

  it("falls back to a 400 for unmapped Prisma error codes", () => {
    const { status } = catchAndCapture(prismaError("P2014"));
    expect(status).toHaveBeenCalledWith(400);
  });
});
