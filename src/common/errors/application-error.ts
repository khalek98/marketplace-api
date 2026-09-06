export class ApplicationError extends Error {
  constructor(
    public readonly status: number,
    public readonly title: string,
    detail: string,
    public readonly type: string,
  ) {
    super(detail);
    this.name = "ApplicationError";
  }
}
