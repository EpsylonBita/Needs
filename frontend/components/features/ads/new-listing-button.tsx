'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Plus } from 'lucide-react';
import { AuthDialog } from '@/components/auth/auth-dialog';
import { Button, type ButtonProps } from '@/components/ui/button';
import { useAuth } from '@/contexts/auth-context';
import { useI18n } from '@/contexts/i18n-context';
const CreateAdDialog = dynamic(() => import('./create-ad-dialog').then(module => module.CreateAdDialog));
export function NewListingButton({ variant = 'default', className }: Pick<ButtonProps, 'variant' | 'className'>) {
  const { user, isLoading } = useAuth();
  const { t } = useI18n();
  const [signIn, setSignIn] = useState(false);
  const [create, setCreate] = useState(false);
  return <>
    <Button variant={variant} className={className} disabled={isLoading} onClick={() => user ? setCreate(true) : setSignIn(true)}>
      <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />{t('modern.newListing', 'New listing')}
    </Button>
    <AuthDialog isOpen={signIn} onClose={() => setSignIn(false)} onAuthenticated={() => { setSignIn(false); setCreate(true); }} />
    {create && <CreateAdDialog open={create} onOpenChange={setCreate} />}
  </>;
}
