export type FileType = 'code' | 'markdown' | 'image' | 'unsupported';

export interface ShowFileParams {
  path: string;
  startLine?: number;
  endLine?: number;
}

export type ValidationResult =
  | { valid: true; absolutePath: string; fileType: FileType; lineCount: number | undefined; sizeBytes: number }
  | { valid: false; errorMessage: string };
