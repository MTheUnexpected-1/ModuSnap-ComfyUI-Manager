'use client';

import { useEffect, useState } from 'react';
import NodesManagerModal from '../components/NodesManagerModal';

export default function ManagerPage() {
  const [objectInfo, setObjectInfo] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadObjectInfo() {
      try {
        const res = await fetch('/api/manager/proxy/object_info', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (mounted && data && typeof data === 'object') {
          setObjectInfo(data as Record<string, any>);
        }
      } catch {
        // keep null until backend is reachable
      }
    }

    void loadObjectInfo();
    const timer = setInterval(loadObjectInfo, 6000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  return <NodesManagerModal isOpen={true} onClose={() => {}} objectInfo={objectInfo} />;
}
