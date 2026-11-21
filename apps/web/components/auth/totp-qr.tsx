"use client";

import { useMemo } from "react";

import { createQrMatrix, qrMatrixToSvgPath } from "./qr-code";

export function TotpQr({ uri, label = "验证器二维码" }: { uri: string; label?: string }) {
  const matrix = useMemo(() => createQrMatrix(uri), [uri]);
  const path = useMemo(() => qrMatrixToSvgPath(matrix), [matrix]);
  const size = (matrix.length + 8) * 5;

  return (
    <div className="overflow-hidden rounded-control border border-hairline bg-white p-3">
      <svg
        role="img"
        aria-label={label}
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto h-auto w-full max-w-[220px]"
      >
        <rect width={size} height={size} fill="#ffffff" />
        <path d={path} fill="#000000" />
      </svg>
    </div>
  );
}
