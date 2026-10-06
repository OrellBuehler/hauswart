export type FileErrorCode =
  | "empty"
  | "too_large"
  | "unsupported_type"
  | "unsupported_heic"
  | "corrupt_image"
  | "image_too_large"
  | "invalid_path";

export class FileError extends Error {
  readonly code: FileErrorCode;

  constructor(code: FileErrorCode, message?: string) {
    super(message ?? code);
    this.name = "FileError";
    this.code = code;
  }
}
