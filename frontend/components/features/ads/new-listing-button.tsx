'use client';
import { useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { Plus } from 'lucide-react';
import { AuthDialog } from '@/components/auth/auth-dialog';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
import { clearAuthContinuation } from '@/lib/auth/return-path';
import { clearPendingPublication, isPublicationDraftCurrent, savePendingPublication, type PendingPublication, type PublicationDraft, type PublicationIntent } from '@/lib/listings/publication-intent';
const CreateAdDialog = dynamic(() => import('./create-ad-dialog').then(module => module.CreateAdDialog));
export function NewListingButton({ variant = 'default', className, intent, initialDraft, children }: Pick<ButtonProps, 'variant' | 'className'> & { intent?: PublicationIntent; initialDraft?: PublicationDraft; children?: ReactNode }) {
  const { user, isLoading } = useAuth();
  const { t } = useI18n();
  const [signIn, setSignIn] = useState(false);
  const [create, setCreate] = useState(false);
  const [draft, setDraft] = useState<PendingPublication | undefined>();
  function cancel() { setSignIn(false); clearPendingPublication(); clearAuthContinuation(); }
  return <>
    <Button variant={variant} className={className} disabled={isLoading} onClick={() => {
      setDraft(savePendingPublication({ ...initialDraft, intent, returnTo: window.location.pathname + window.location.search }, user?.id));
      if (user) setCreate(true); else setSignIn(true);
    }}>
      <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />{children ?? t('modern.newListing', 'New listing')}
    </Button>
    <AuthDialog isOpen={signIn} purpose={intent ?? 'listing'} onClose={cancel} onNavigateAway={() => setSignIn(false)} onAwaitingConfirmation={() => setSignIn(false)} onAuthenticated={() => {
      setSignIn(false);
      if (draft && !isPublicationDraftCurrent(draft, user?.id)) { setDraft(undefined); clearPendingPublication(); }
      clearAuthContinuation(); setCreate(true);
    }} />
    {create && <CreateAdDialog open={create} initialDraft={draft} onOpenChange={open => { setCreate(open); if (!open) { clearPendingPublication(); clearAuthContinuation(); } }} />}
  </>;
}
