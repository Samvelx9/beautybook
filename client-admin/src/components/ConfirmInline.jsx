// The one way the admin asks "are you sure?": the question and a confirm button
// take the action's place in the row, so nothing pops over the page and the
// master's eyes stay where they clicked. Kept for slips that can't be taken back.
export default function ConfirmInline({ T, message, confirmLabel, cancelLabel, onConfirm, onCancel, busy }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12.5, color: 'var(--terracotta)' }}>{message}</span>
      <button className="btn-danger-outline" onClick={onConfirm} disabled={busy}>
        {confirmLabel ?? T.confirmDeleteBtn}
      </button>
      <button className="btn-outline" onClick={onCancel} disabled={busy}>
        {cancelLabel ?? T.cancelBtn}
      </button>
    </span>
  );
}
