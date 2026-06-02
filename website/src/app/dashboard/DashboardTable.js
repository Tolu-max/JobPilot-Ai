"use client";

import { useMemo, useState } from 'react';
import { ArrowUpDown, Check, ExternalLink, Loader2, Search, X } from 'lucide-react';
import { updateJobStatus } from '../actions';

const FILTERS = {
  queue: ['all', 'reviewed', 'approved', 'pending_apply'],
  history: ['all', 'applied', 'failed', 'rejected', 'skipped'],
  all: ['all', 'reviewed', 'approved', 'pending_apply', 'applied', 'failed', 'rejected', 'skipped'],
};

function statusLabel(status) {
  return String(status || 'pending').replace(/_/g, ' ');
}

function statusBadge(status) {
  if (status === 'applied') return 'badge badge-green';
  if (status === 'reviewed') return 'badge badge-amber';
  if (status === 'approved' || status === 'pending_apply') return 'badge badge-blue';
  if (status === 'failed' || status === 'rejected') return 'badge badge-red';
  return 'badge';
}

function scoreBadge(score) {
  const value = Number(score || 0);
  if (value >= 75) return 'badge badge-green';
  if (value >= 50) return 'badge badge-amber';
  return 'badge';
}

export default function DashboardTable({ initialJobs = [], mode = 'all' }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' });
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [loadingId, setLoadingId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  const filters = FILTERS[mode] || FILTERS.all;

  const handleSort = (key) => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const handleStatusUpdate = async (id, newStatus) => {
    setLoadingId(id);
    const result = await updateJobStatus(id, newStatus);
    if (result.success) {
      setJobs((current) => current.map((job) => (job.id === id ? { ...job, status: newStatus, updated_at: new Date().toISOString() } : job)));
    } else {
      alert(`Failed to update status: ${result.error}`);
    }
    setLoadingId(null);
  };

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return jobs.filter((job) => {
      const statusMatch = filter === 'all' || job.status === filter;
      if (!statusMatch) return false;
      if (!normalizedQuery) return true;
      return [
        job.title,
        job.company,
        job.source_site,
        job.status,
      ].some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
    });
  }, [jobs, filter, query]);

  const sortedJobs = useMemo(() => {
    return [...filteredJobs].sort((a, b) => {
      if (sortConfig.key === 'score') {
        const valA = Number(a.score || 0);
        const valB = Number(b.score || 0);
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      }
      if (sortConfig.key === 'created_at' || sortConfig.key === 'updated_at') {
        const valA = new Date(a[sortConfig.key] || a.created_at || 0).getTime();
        const valB = new Date(b[sortConfig.key] || b.created_at || 0).getTime();
        return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
      }
      const valA = String(a[sortConfig.key] || '').toLowerCase();
      const valB = String(b[sortConfig.key] || '').toLowerCase();
      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredJobs, sortConfig]);

  const totalPages = Math.max(1, Math.ceil(sortedJobs.length / itemsPerPage));
  const page = Math.min(currentPage, totalPages);
  const paginatedJobs = sortedJobs.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  const updateFilter = (value) => {
    setFilter(value);
    setCurrentPage(1);
  };

  return (
    <section className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px', flexWrap: 'wrap', gap: '14px' }}>
        <div>
          <h2 className="heading-sm">Job Pipeline</h2>
          <p className="muted">{sortedJobs.length} visible job{sortedJobs.length === 1 ? '' : 's'}</p>
        </div>

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <label style={{ position: 'relative', minWidth: 230 }}>
            <Search size={16} style={{ position: 'absolute', left: 11, top: 12, color: 'var(--text-dim)' }} />
            <input
              className="input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search jobs"
              style={{ paddingLeft: 34 }}
            />
          </label>
          <div style={{ display: 'flex', gap: '6px', padding: '4px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-soft)', overflowX: 'auto' }}>
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => updateFilter(item)}
                className={filter === item ? 'button button-primary' : 'button button-ghost'}
                style={{ minHeight: 34, padding: '8px 10px', fontSize: '0.82rem', textTransform: 'capitalize' }}
              >
                {statusLabel(item)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('title')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Role <ArrowUpDown size={14} /></span>
              </th>
              <th onClick={() => handleSort('company')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Company <ArrowUpDown size={14} /></span>
              </th>
              <th onClick={() => handleSort('source_site')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Source <ArrowUpDown size={14} /></span>
              </th>
              <th onClick={() => handleSort('score')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Score <ArrowUpDown size={14} /></span>
              </th>
              <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Status <ArrowUpDown size={14} /></span>
              </th>
              <th onClick={() => handleSort('updated_at')} style={{ cursor: 'pointer' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>Updated <ArrowUpDown size={14} /></span>
              </th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedJobs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '42px', textAlign: 'center' }}>
                  No jobs found for this view.
                </td>
              </tr>
            ) : (
              paginatedJobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    <div style={{ color: 'var(--text-main)', fontWeight: 750 }}>{job.title || 'Untitled role'}</div>
                    <div className="dim" style={{ fontSize: '0.82rem' }}>{job.created_at ? new Date(job.created_at).toLocaleDateString() : 'No date'}</div>
                  </td>
                  <td>{job.company || 'Unknown'}</td>
                  <td>{job.source_site || 'Unknown'}</td>
                  <td><span className={scoreBadge(job.score)}>{job.score ?? 0}</span></td>
                  <td><span className={statusBadge(job.status)}>{statusLabel(job.status)}</span></td>
                  <td>{job.updated_at ? new Date(job.updated_at).toLocaleDateString() : 'Never'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                      {job.job_url && (
                        <a href={job.job_url} target="_blank" rel="noreferrer" className="button button-ghost icon-button" title="Open job">
                          <ExternalLink size={16} />
                        </a>
                      )}

                      {job.status === 'reviewed' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleStatusUpdate(job.id, 'approved')}
                            disabled={loadingId === job.id}
                            className="button button-ghost icon-button"
                            title="Approve for local runner"
                            style={{ color: 'var(--green)', borderColor: 'rgba(36, 193, 122, 0.28)' }}
                          >
                            {loadingId === job.id ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusUpdate(job.id, 'rejected')}
                            disabled={loadingId === job.id}
                            className="button button-danger icon-button"
                            title="Reject role"
                          >
                            {loadingId === job.id ? <Loader2 size={16} className="spin" /> : <X size={16} />}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '18px', flexWrap: 'wrap' }}>
        <span className="muted">Page {page} of {totalPages}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button type="button" disabled={page === 1} onClick={() => setCurrentPage((current) => Math.max(1, current - 1))} className="button button-ghost">
            Previous
          </button>
          <button type="button" disabled={page === totalPages} onClick={() => setCurrentPage((current) => Math.min(totalPages, current + 1))} className="button button-ghost">
            Next
          </button>
        </div>
      </div>

      <style>{`
        .spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </section>
  );
}
