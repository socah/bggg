'use client';

import { Button } from '@/components/ui/button';
import { useInstallApp } from '@/components/install-app-provider';

export function InstallAppSettings() {
  const { promptEvent, installed, isIOS, clearPrompt } = useInstallApp();

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    await promptEvent.userChoice;
    clearPrompt();
  }

  if (installed) return <p className="text-sm text-text-muted">BGGG is installed on this device.</p>;
  if (promptEvent) return <Button type="button" onClick={() => void install()}>Install BGGG</Button>;
  if (isIOS) return <p className="text-sm text-text-muted">To install BGGG, open Share in Safari and choose Add to Home Screen.</p>;
  return <p className="text-sm text-text-muted">Use your browser&apos;s Install app or Add to Home Screen menu to install BGGG.</p>;
}
