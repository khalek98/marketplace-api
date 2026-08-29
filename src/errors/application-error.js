export class ApplicationError extends Error {
  constructor(status, title, detail, type) {
    super(detail);
    this.name = "ApplicationError";
    this.status = status;
    this.title = title;
    this.type = type;
  }
}
