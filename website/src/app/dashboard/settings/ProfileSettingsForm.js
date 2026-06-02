"use client";

import { useState, useTransition } from 'react';
import { Save } from 'lucide-react';
import { updateProfileSettings } from '../../actions';

export default function ProfileSettingsForm({ profile }) {
  const [form, setForm] = useState({
    display_name: profile.display_name || '',
    role_summary: profile.role_summary || '',
    min_score: profile.min_score ?? 70,
    auto_apply: Boolean(profile.auto_apply),
  });
  const [message, setMessage] = useState('');
  const [isPending, startTransition] = useTransition();

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setMessage('');
    startTransition(async () => {
      const result = await updateProfileSettings(profile.id, form);
      setMessage(result.success ? 'Saved' : `Error: ${result.error}`);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="panel form-grid">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
        <div>
          <h2 className="heading-sm">{profile.display_name || profile.profile_name}</h2>
          <p className="muted" style={{ marginTop: 4 }}>Profile key: <code>{profile.profile_name}</code></p>
        </div>
        <span className={profile.auto_apply ? 'badge badge-green' : 'badge badge-amber'}>
          {profile.auto_apply ? 'Auto apply allowed' : 'Review only'}
        </span>
      </div>

      <div className="grid-2">
        <div className="field">
          <label htmlFor={`${profile.id}-display`}>Display name</label>
          <input
            id={`${profile.id}-display`}
            className="input"
            value={form.display_name}
            onChange={(event) => update('display_name', event.target.value)}
            maxLength={120}
            placeholder="Frontend Engineer"
          />
        </div>
        <div className="field">
          <label htmlFor={`${profile.id}-score`}>Minimum score</label>
          <input
            id={`${profile.id}-score`}
            className="input"
            type="number"
            min="0"
            max="100"
            value={form.min_score}
            onChange={(event) => update('min_score', event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${profile.id}-summary`}>Role summary</label>
        <textarea
          id={`${profile.id}-summary`}
          className="textarea"
          value={form.role_summary}
          onChange={(event) => update('role_summary', event.target.value)}
          maxLength={500}
          placeholder="What this profile is targeting."
        />
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', fontWeight: 650 }}>
        <input
          type="checkbox"
          checked={form.auto_apply}
          onChange={(event) => update('auto_apply', event.target.checked)}
        />
        Allow the local runner to auto-apply after approved/audited checks
      </label>

      {Array.isArray(profile.enabled_sites) && profile.enabled_sites.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {profile.enabled_sites.map((site) => (
            <span key={site} className="badge">{site}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
        <p className={message.startsWith('Error') ? 'badge badge-red' : message ? 'badge badge-green' : 'muted'}>
          {message || 'Safe metadata only. Keep secrets in the CLI.'}
        </p>
        <button type="submit" className="button button-primary" disabled={isPending}>
          <Save size={16} /> {isPending ? 'Saving' : 'Save'}
        </button>
      </div>
    </form>
  );
}
