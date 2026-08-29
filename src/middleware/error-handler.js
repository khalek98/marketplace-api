import { ApplicationError } from "../errors/application-error.js";

export function notFoundHandler(req, res, next) {
  next(
    new ApplicationError(
      404,
      "Route not found",
      `No API operation matches ${req.method} ${req.originalUrl}.`,
      "route-not-found",
    ),
  );
}

export function errorHandler(error, req, res, _next) {
  const status =
    Number.isInteger(error.status) && error.status >= 400 && error.status <= 599
      ? error.status
      : 500;
  const isValidatorError = Array.isArray(error.errors);
  const title =
    error.title ??
    (isValidatorError
      ? status >= 500
        ? "Response validation failed"
        : "Request validation failed"
      : status >= 500
        ? "Internal server error"
        : "Request failed");
  const typeSlug =
    error.type ??
    (isValidatorError
      ? status >= 500
        ? "response-validation-error"
        : "request-validation-error"
      : "internal-error");
  const detail =
    typeof error.message === "string" && error.message.length > 0
      ? error.message
      : "The request could not be completed.";

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
}
