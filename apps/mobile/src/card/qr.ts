import qrcode from "qrcode-generator";

export interface QrModule {
  readonly key: string;
  readonly dark: boolean;
}
export interface QrRow {
  readonly key: string;
  readonly modules: readonly QrModule[];
}

/** The modules of a QR code for `value`, row by row, each with a stable key. Medium error correction. */
export function qrMatrix(value: string): readonly QrRow[] {
  const code = qrcode(0, "M");
  code.addData(value);
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => ({
    key: `row-${row}`,
    modules: Array.from({ length: size }, (_, col) => ({
      key: `module-${col}`,
      dark: code.isDark(row, col),
    })),
  }));
}
