import { Catch, ExceptionFilter, ArgumentsHost } from "@nestjs/common";
import { Request, Response } from "express";

@Catch()
export class ProblemJsonFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const err = exception as {
      status?: number;
      title?: string;
      type?: string;
      message?: string;
      errors?: unknown;
    };

    const status =
      Number.isInteger(err.status) && Number(err.status) >= 400 && Number(err.status) <= 599 ? Number(err.status) : 500;
    const isValidatorError = Array.isArray(err.errors) && err.errors.length > 0;
    const title =
      err.title ??
      (isValidatorError
        ? status >= 500
          ? "Response validation failed"
          : "Request validation failed"
        : status >= 500
          ? "Internal server error"
          : "Request failed");
    const typeSlug =
      err.type ??
      (isValidatorError
        ? status >= 500
          ? "response-validation-error"
          : "request-validation-error"
        : "internal-error");
    const detail =
      status >= 500
        ? "The request could not be completed."
        : typeof err.message === "string" && err.message.length > 0
          ? err.message
          : "The request could not be completed.";

    if (status >= 500) {
      console.error("[5xx]", {
        status,
        message: err.message,
        errors: err.errors,
        path: req.originalUrl || req.url || "/",
      });
    }

    res
      .status(status)
      .type("application/problem+json")
      .send({
        type: `https://marketplace.example/problems/${typeSlug}`,
        title,
        status,
        detail,
        instance: req.originalUrl || req.url || "/",
      });

    return;
  }
}
