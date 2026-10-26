/* @jsxImportSource react */

import { ClientSearchPage } from '@/components/features/search/client-search-page';

export default function ItemsPage() {
  return (
    <div className="needs-shell needs-search-page">
      <ClientSearchPage category="Items" />
    </div>
  );
}
