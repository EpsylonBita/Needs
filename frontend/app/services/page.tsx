import { ClientSearchPage } from '@/components/features/search/client-search-page';

export default function ServicesPage() {
  return (
    <div className="needs-shell needs-search-page">
      <ClientSearchPage category="Services" />
    </div>
  );
} 
