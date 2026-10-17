import { useState } from 'react';
import { api, ApiError } from '../api.js';
import ConfirmInline from './ConfirmInline.jsx';

// The operator deleting an account: an individual master's, or a salon with
// all its masters. Typing the owner's email arms it; the inline question is
// the last step. Refused while a subscription is live.
export default function DeleteOrganizationCard({ T, organization, onDeleted, onAuthError }) {
  const [confirm, setConfirm] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState(null);
  const matches = confirm.trim().toLowerCase() === (organization.ownerEmail ?? '').toLowerCase();

  async function remove() {
    setAsking(false);
    setError(null);
    try {
      await api.deletePlatformOrganization(organization.id, confirm.trim());
      onDeleted();
    } catch (err) {
      if (!onAuthError(err)) setError(err instanceof ApiError && T[err.code] ? err.code : 'genericError');
    }
  }

  return (
    <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: 'var(--terracotta)' }}>
      <h3 style={{ fontSize: 16, fontWeight: 600 }}>{T.deleteOrgTitle}</h3>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
        {organization.kind === 'salon' ? T.deleteOrgSalonHint : T.deleteOrgHint}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) setAsking(true);
        }}
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}
      >
        <input
          className="field-input"
          style={{ maxWidth: 300 }}
          aria-label={T.deleteOrgConfirmLabel(organization.ownerEmail)}
          placeholder={organization.ownerEmail}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {asking ? (
          <ConfirmInline T={T} message={T.deleteOrgConfirm} confirmLabel={T.deleteBtn} onConfirm={remove} onCancel={() => setAsking(false)} />
        ) : (
          <button type="submit" className="btn-danger-outline" disabled={!matches}>{T.deleteBtn}</button>
        )}
      </form>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{T.deleteOrgConfirmLabel(organization.ownerEmail)}</span>
      {error && <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--terracotta)' }}>{T[error]}</p>}
    </section>
  );
}
