import type { ConfirmationDialogState } from "./useConfirmationDialog";

type ConfirmationModalProps = {
  dialogId: string;
  dialog: ConfirmationDialogState | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmationModal({
  dialogId,
  dialog,
  onConfirm,
  onCancel,
}: ConfirmationModalProps): JSX.Element | null {
  if (!dialog) {
    return null;
  }

  return (
    <div
      className="nh3d-dialog nh3d-dialog-question nh3d-dialog-fixed-actions is-visible"
      id={dialogId}
    >
      {dialog.title ? <div className="nh3d-options-title">{dialog.title}</div> : null}
      <div className="nh3d-question-text">{dialog.message}</div>
      <div className="nh3d-menu-actions">
        <button
          className={`nh3d-menu-action-button ${dialog.confirmClassName}`}
          onClick={onConfirm}
          type="button"
        >
          {dialog.confirmLabel}
        </button>
        <button
          className="nh3d-menu-action-button nh3d-menu-action-cancel"
          onClick={onCancel}
          type="button"
        >
          {dialog.cancelLabel}
        </button>
      </div>
    </div>
  );
}
