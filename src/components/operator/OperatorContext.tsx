"use client";

import { createContext, useContext, type ReactNode } from "react";

/** ログイン中のオペレーター（サーバー側のガードで確認済みの値） */
export type OperatorInfo = { id: string; email: string | null };

const OperatorContext = createContext<OperatorInfo | null>(null);

export function OperatorProvider({ operator, children }: { operator: OperatorInfo; children: ReactNode }) {
  return <OperatorContext.Provider value={operator}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorInfo {
  const value = useContext(OperatorContext);
  if (!value) throw new Error("useOperator は OperatorProvider の内側で使ってください");
  return value;
}
