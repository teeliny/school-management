import { ArgumentsHost, BadRequestException, Catch, ConflictException, ExceptionFilter, HttpException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

// Minimal shape, not express.Response — express isn't a direct dependency
// of this app (same precedent as metrics.middleware.ts's MetricsResponse).
interface HttpFilterResponse {
  status(code: number): { json(body: unknown): void };
}

// Without this, an unguarded Prisma call (findUniqueOrThrow, a unique-
// constraint insert, a write against a dangling foreign key, ...) throws a
// PrismaClientKnownRequestError, which Nest doesn't recognize as an
// HttpException — it falls through to the generic 500 "Internal server
// error" body, discarding any hint of what actually went wrong. This maps
// the common Prisma error codes to the same distinct, user-facing messages
// a manual check + HttpException would have produced.
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpFilterResponse>();
    const mapped = this.toHttpException(exception);
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private toHttpException(exception: Prisma.PrismaClientKnownRequestError): HttpException {
    switch (exception.code) {
      case "P2025":
        return new NotFoundException("The requested record was not found");
      case "P2002": {
        const target = exception.meta?.target;
        const fields = Array.isArray(target) ? target.join(", ") : String(target ?? "field");
        return new ConflictException(`A record with this ${fields} already exists`);
      }
      case "P2003": {
        const field = exception.meta?.field_name;
        return new BadRequestException(`Invalid reference${field ? ` for "${String(field)}"` : ""} — the related record does not exist`);
      }
      default:
        return new BadRequestException("The request could not be completed due to a data conflict");
    }
  }
}
