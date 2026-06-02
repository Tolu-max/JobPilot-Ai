"use client";

import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { Users } from 'lucide-react';

export default function ProfileSelector() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selected = searchParams.get('profile') || '';

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('profiles')
        .select('profile_name, display_name')
        .order('profile_name');
      if (!cancelled) {
        setProfiles(data || []);
        setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || profiles.length <= 1) return null;

  const handleChange = (event) => {
    const value = event.target.value;
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('profile', value);
    else params.delete('profile');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <Users size={15} style={{ color: 'var(--text-muted)' }} />
      <select value={selected} onChange={handleChange} className="select" style={{ minHeight: 38, minWidth: 150, fontSize: '0.88rem' }}>
        <option value="">All profiles</option>
        {profiles.map((profile) => (
          <option key={profile.profile_name} value={profile.profile_name}>
            {profile.display_name || profile.profile_name}
          </option>
        ))}
      </select>
    </label>
  );
}
