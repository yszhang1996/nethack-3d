import { useCallback, useEffect, useRef, useState } from "react";

export type ConfirmationDialogRequest = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmClassName?: string;
};

export type ConfirmationDialogState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmClassName: string;
};

export function useConfirmationDialog() {
  const [dialog, setDialog] = useState<ConfirmationDialogState | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const resolveConfirmation = useCallback((confirmed: boolean): void => {
    setDialog(null);
    const resolve = resolveRef.current;
    resolveRef.current = null;
    resolve?.(confirmed);
  }, []);

  const requestConfirmation = useCallback(
    (request: ConfirmationDialogRequest): Promise<boolean> => {
      const normalized: ConfirmationDialogState = {
        title: String(request.title || "").trim(),
        message: String(request.message || "").trim(),
        confirmLabel: String(request.confirmLabel || "确认").trim() || "确认",
        cancelLabel: String(request.cancelLabel || "取消").trim() || "取消",
        confirmClassName:
          String(request.confirmClassName || "nh3d-menu-action-confirm").trim() ||
          "nh3d-menu-action-confirm",
      };
      if (!normalized.message) {
        return Promise.resolve(false);
      }
      if (resolveRef.current) {
        resolveRef.current(false);
      }
      return new Promise<boolean>((resolve) => {
        resolveRef.current = resolve;
        setDialog(normalized);
      });
    },
    [],
  );

  useEffect(() => {
    return () => {
      const resolve = resolveRef.current;
      resolveRef.current = null;
      resolve?.(false);
    };
  }, []);

  return {
    dialog,
    requestConfirmation,
    resolveConfirmation,
  };
}
